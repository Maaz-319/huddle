import { Injectable } from '@nestjs/common';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/errors';
import { ChannelMemberRepository } from './channel-member-repository.interface';
import {
  Channel,
  ChannelRepository,
  CreateChannelInput,
  UpdateChannelInput,
} from './channel-repository.interface';
import { Invite, InviteRepository } from './invite-repository.interface';
import {
  Membership,
  MembershipRepository,
} from './membership-repository.interface';
import {
  Server,
  ServerRepository,
  UpdateServerInput,
} from './server-repository.interface';

/** What a caller supplies to create a server; everything else gets a default. */
export interface CreateServerRequest {
  name: string;
  iconUrl: string | null;
}

/**
 * Server/membership/invite orchestration, depending only on the three ports
 * (AGENTS.md section 2) — no Prisma types belong in this file.
 */
@Injectable()
export class AdministrationService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly memberships: MembershipRepository,
    private readonly invites: InviteRepository,
    private readonly channels: ChannelRepository,
    private readonly channelMembers: ChannelMemberRepository,
  ) {}

  /**
   * Creates a server and seats the caller as its owner, atomically. Defaults
   * — confirmed with no doc specifying them otherwise — are `everyone` for
   * channel creation and `true` for the member-invite toggle: a new server
   * starts maximally open, and the owner tightens it later via #35.
   */
  async createServer(
    ownerId: bigint,
    request: CreateServerRequest,
  ): Promise<Server> {
    const { server } = await this.servers.createWithOwner(
      {
        name: request.name,
        iconUrl: request.iconUrl,
        channelCreationPolicy: 'everyone',
        memberInviteToggle: true,
      },
      ownerId,
    );

    return server;
  }

  /** Every server this user belongs to. */
  async listMyServers(userId: bigint): Promise<Server[]> {
    const memberships = await this.memberships.findByUserId(userId);

    const servers = await Promise.all(
      memberships.map((membership) =>
        this.servers.findById(membership.serverId),
      ),
    );

    // A membership always points at a real server (Restrict, never Cascade,
    // is the other direction) -- null here would mean the two tables have
    // drifted, which is a bug, not a case to paper over with a filter.
    return servers.map((server, index) => {
      if (server === null) {
        throw new Error(
          `Membership names server ${memberships[index].serverId.toString()}, which does not exist`,
        );
      }

      return server;
    });
  }

  /**
   * One server's details. Throws `NotFoundError` if the caller is not a
   * member — servers are not publicly readable, so a non-member learns
   * nothing about whether the id even exists (404, never 403).
   */
  async getServer(serverId: bigint, callerId: bigint): Promise<Server> {
    const membership = await this.memberships.findByServerAndUser(
      serverId,
      callerId,
    );

    if (membership === null) {
      throw new NotFoundError('Server not found', {
        serverId: serverId.toString(),
      });
    }

    const server = await this.servers.findById(serverId);

    // Same invariant as listMyServers: a membership always names a real
    // server, so null here is a data-integrity bug, not a 404 case.
    if (server === null) {
      throw new Error(
        `Membership names server ${serverId.toString()}, which does not exist`,
      );
    }

    return server;
  }

  /**
   * The server's invite, for a caller who is already inside the server.
   *
   * The role check is split across two layers on purpose. `RequireRoleGuard`
   * has already answered "are you in this server at all", including the
   * 403-vs-404 disambiguation a non-member and a nonexistent server need. What
   * it cannot answer is this: `@RequireRole` compares against a static list,
   * and whether an ordinary Member may see the link depends on a per-server
   * setting the decorator has no way to read. So the guard answers "are you in
   * this server", and this method answers "does this server let your role see
   * the link".
   *
   * Owners and Moderators ignore `memberInviteToggle` entirely — PRD section 5
   * gives them the capability unconditionally, and it is only the Member row
   * that reads "Configurable".
   *
   * A revoked invite is returned, with `revokedAt` populated, rather than
   * hidden behind a 404: the client has to be told the link is dead in order
   * to say so, and a 404 would make a revoked server look like a missing one.
   * This is deliberately the opposite of the join path, where a revoked code
   * 404s — that route serves people outside the server, this one people
   * already inside it.
   */
  async getInvite(serverId: bigint, callerId: bigint): Promise<Invite> {
    const membership = await this.memberships.findByServerAndUser(
      serverId,
      callerId,
    );

    // The guard has already rejected a non-member, so a null here would mean
    // this method was reached without it -- a wiring bug, not a 403 case.
    if (membership === null) {
      throw new ForbiddenError('Not a member of this server', {
        serverId: serverId.toString(),
      });
    }

    if (membership.role === 'member') {
      const server = await this.servers.findById(serverId);

      // Same invariant as getServer: a membership always names a real server.
      if (server === null) {
        throw new Error(
          `Membership names server ${serverId.toString()}, which does not exist`,
        );
      }

      if (!server.memberInviteToggle) {
        throw new ForbiddenError(
          'This server does not let members share the invite link',
          { serverId: serverId.toString() },
        );
      }
    }

    const invite = await this.invites.findByServerId(serverId);

    if (invite === null) {
      throw new NotFoundError('Invite not found', {
        serverId: serverId.toString(),
      });
    }

    return invite;
  }

  /**
   * Kills the server's current invite link. Authorization (owner or moderator)
   * already happened in `RequireRoleGuard`.
   *
   * `memberInviteToggle` is deliberately *not* consulted here. The toggle
   * governs viewing and sharing only — PRD section 5 is explicit that revoke
   * and regenerate are Owner and Moderator alone, so a Member with the toggle
   * on can read the code and can still never destroy it.
   */
  async revokeInvite(serverId: bigint): Promise<Invite> {
    return this.invites.revoke(serverId);
  }

  /**
   * Replaces the server's invite code in place. Same authorization note as
   * `revokeInvite`, including the toggle not applying.
   *
   * This is also how a revoked invite comes back to life: `regenerate` clears
   * `revokedAt`, and there is deliberately no separate un-revoke operation —
   * a server has exactly one slot, either live or dead
   * (administration-service.md section 5).
   */
  async regenerateInvite(serverId: bigint): Promise<Invite> {
    return this.invites.regenerate(serverId);
  }

  /**
   * Applies a partial update. Authorization (owner-only) already happened in
   * `RequireRoleGuard` — this method does not re-check the caller's role.
   */
  async updateServer(
    serverId: bigint,
    patch: UpdateServerInput,
  ): Promise<Server> {
    return this.servers.update(serverId, patch);
  }

  /** Hard-deletes the server. Same authorization note as `updateServer`. */
  async deleteServer(serverId: bigint): Promise<void> {
    await this.servers.delete(serverId);
  }

  /**
   * The server an invite code points at, for someone not yet inside it.
   *
   * Only enough to answer "join this?" — the caller is not a member, so they
   * learn nothing about member counts, channels, or who owns it.
   */
  async previewInvite(code: string): Promise<Server> {
    const invite = await this.requireLiveInvite(code);
    const server = await this.servers.findById(invite.serverId);

    // Invite cascades off Server, so a live invite always names a real one.
    if (server === null) {
      throw new Error(
        `Invite names server ${invite.serverId.toString()}, which does not exist`,
      );
    }

    return server;
  }

  /**
   * Seats the caller in the server the code points at, as a `member`.
   *
   * Idempotent: a double-clicked join button is not a failure condition, so a
   * caller who is already a member gets the same 200 and the same body, and
   * exactly one `Membership` row exists either way. The route must never
   * surface a 409.
   */
  async joinByCode(code: string, userId: bigint): Promise<Server> {
    const server = await this.previewInvite(code);

    const existing = await this.memberships.findByServerAndUser(
      server.id,
      userId,
    );

    if (existing === null) {
      await this.memberships.create({
        serverId: server.id,
        userId,
        role: 'member',
      });
    }

    return server;
  }

  /**
   * The live invite for a code, or the one 404 both invite-code routes give.
   *
   * An unknown code and a revoked code fail identically, through this single
   * path, and the error carries no `details`. If a revoked code produced a
   * distinguishable response the endpoint would be an oracle for which codes
   * used to be valid, and putting the code into `details` would make two
   * different unknown codes distinguishable from each other.
   *
   * This is the opposite of `getInvite`, which returns a revoked invite
   * rather than hiding it — that route serves people already inside the
   * server, and this one serves people outside it.
   */
  private async requireLiveInvite(code: string): Promise<Invite> {
    const invite = await this.invites.findByCode(code);

    if (invite === null || invite.revokedAt !== null) {
      throw new NotFoundError('Invite not found');
    }

    return invite;
  }

  /**
   * Promotes/demotes a member between `moderator` and `member`. Authorization
   * (owner-only) already happened in `RequireRoleGuard`.
   *
   * The server's current owner can never be "demoted" through this route —
   * that would silently create a zero-owner server without going through
   * `transferOwnership`'s safeguards — so this checks the target's current
   * role rather than trusting the guard alone, which only confirms the
   * *caller* is the owner.
   */
  async updateMemberRole(
    serverId: bigint,
    targetUserId: bigint,
    role: 'moderator' | 'member',
  ): Promise<Membership> {
    const target = await this.memberships.findByServerAndUser(
      serverId,
      targetUserId,
    );

    if (target === null) {
      throw new NotFoundError('User is not a member of this server', {
        serverId: serverId.toString(),
        userId: targetUserId.toString(),
      });
    }

    if (target.role === 'owner') {
      throw new ValidationError(
        "Cannot change the server owner's role through this route",
        { serverId: serverId.toString(), userId: targetUserId.toString() },
      );
    }

    return this.memberships.updateRole(serverId, targetUserId, role);
  }

  /**
   * Hands ownership from the caller to an existing member, unilaterally and
   * immediately — no acceptance step (administration-service.md section 3).
   * Authorization (owner-only) already happened in `RequireRoleGuard`.
   */
  async transferOwnership(
    serverId: bigint,
    fromUserId: bigint,
    toUserId: bigint,
  ): Promise<void> {
    if (fromUserId === toUserId) {
      throw new ValidationError('Cannot transfer ownership to yourself', {
        serverId: serverId.toString(),
        userId: toUserId.toString(),
      });
    }

    await this.memberships.transferOwnership(serverId, fromUserId, toUserId);
  }

  /**
   * Creates a channel in a server. Whether this caller's role is one the
   * server's `channelCreationPolicy` admits already happened in
   * `RequireChannelCreationGuard`.
   *
   * What the guard cannot answer is who may create a *private* one. PRD
   * section 5 gives "Make a channel private" to the Owner and Moderator only,
   * and that is a different question from who may create a channel at all —
   * under an `everyone` policy an ordinary Member may create channels and
   * still must not be able to make one private. The guard never sees the
   * body, so the rule lands here, and it costs one membership read on a route
   * budgeted at three calls a minute.
   *
   * `ForbiddenError` rather than `ValidationError`: the body is well-formed,
   * and the refusal is about who the caller is — the same thing
   * `@RequireCapability` answers with a 403.
   *
   * Throws `ConflictError` if the server already holds a channel of that
   * name. The uniqueness is per server, so the same name in a different
   * server is fine.
   */
  async createChannel(
    input: CreateChannelInput,
    callerId: bigint,
  ): Promise<Channel> {
    if (input.isPrivate) {
      const membership = await this.memberships.findByServerAndUser(
        input.serverId,
        callerId,
      );

      // RequireChannelCreationGuard has already rejected a non-member, so a
      // null here would mean this method was reached without it -- a wiring
      // bug, answered the same way the guard would have answered it.
      if (membership === null || membership.role === 'member') {
        throw new ForbiddenError(
          'Only an owner or moderator can create a private channel',
          { serverId: input.serverId.toString() },
        );
      }
    }

    return this.channels.create(input);
  }

  /**
   * The channels in a server that this caller may see.
   *
   * Private channels the caller holds no `ChannelMember` row for are dropped:
   * a private channel is *fully hidden* from non-members and must not appear
   * in their list at all (administration-service.md section 3, PRD section 5).
   * The owner is exempt — authority is a server-level fact a channel can
   * never touch (PRD section 5), so an owner sees every channel in their own
   * server without needing a row.
   *
   * What is deliberately *not* filtered here yet is a `view` capability
   * revoked by a `ChannelOverride`. That lands in #54, which replaces this
   * with a `resolveCapability(..., 'view')` pass over the same list and the
   * same single bulk membership read. Until then a channel a role can see but
   * not view still appears.
   *
   * One `findChannelIdsForUser` call rather than one `isMember` per channel —
   * that is the whole reason the bulk method exists.
   */
  async listChannels(serverId: bigint, callerId: bigint): Promise<Channel[]> {
    const channels = await this.channels.findByServerId(serverId);

    const membership = await this.memberships.findByServerAndUser(
      serverId,
      callerId,
    );

    // RequireRoleGuard has already rejected a non-member, so a null here
    // would mean this method was reached without it -- a wiring bug.
    if (membership === null) {
      throw new ForbiddenError('Not a member of this server', {
        serverId: serverId.toString(),
      });
    }

    if (membership.role === 'owner') return channels;

    const privateIds = channels
      .filter((channel) => channel.isPrivate)
      .map((channel) => channel.id);

    if (privateIds.length === 0) return channels;

    const visible = await this.channelMembers.findChannelIdsForUser(
      privateIds,
      callerId,
    );

    return channels.filter(
      (channel) => !channel.isPrivate || visible.has(channel.id),
    );
  }

  /**
   * Applies a partial update to a channel. Authorization —
   * `manage_settings` on this channel — already happened in
   * `RequireCapabilityGuard`, so this method does not re-check it.
   *
   * Throws `ConflictError` if the server already holds another channel of
   * that name, and `NotFoundError` if the id does not exist. Both come
   * straight from the adapter.
   *
   * **Flipping a channel from private to public leaves its `ChannelMember`
   * rows in place.** They go inert while it is public — nothing reads them,
   * because `resolveCapability` only consults channel membership when the
   * channel is private — and mean exactly what they used to if it is flipped
   * back. Deleting them on the flip would destroy the member list on a
   * misclick, with nothing to rebuild it from, so this is the safe direction
   * to be wrong in.
   */
  async updateChannel(
    channelId: bigint,
    patch: UpdateChannelInput,
  ): Promise<Channel> {
    return this.channels.update(channelId, patch);
  }

  /**
   * Hard-deletes a channel. Same authorization note as `updateChannel`.
   *
   * `Message`, `ChannelMember` and `ChannelOverride` rows go with it through
   * the schema's cascade (data-model.md section 7), and there is deliberately
   * no application-level cleanup here: duplicating the cascade in code means
   * two places that have to be kept in step, and the one in the schema is the
   * one that actually runs. The cascade is asserted directly in
   * `administration-repositories.integration-spec.ts`.
   */
  async deleteChannel(channelId: bigint): Promise<void> {
    await this.channels.delete(channelId);
  }

  /**
   * One channel's details.
   *
   * Deliberately does no authorization of its own: `RequireCapabilityGuard`
   * has already resolved the caller's effective `view` capability, including
   * the hidden-versus-forbidden distinction, which needs the channel row this
   * method would otherwise have to load twice. A null here would mean the
   * route was reached without the guard -- a wiring bug, not a 404 case, but
   * it is answered as a 404 anyway so a misconfiguration can never leak more
   * than the guard would have.
   */
  async getChannel(channelId: bigint): Promise<Channel> {
    const channel = await this.channels.findById(channelId);

    if (channel === null) {
      throw new NotFoundError('Channel not found', {
        channelId: channelId.toString(),
      });
    }

    return channel;
  }
}
