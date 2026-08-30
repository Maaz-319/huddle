import { Injectable } from '@nestjs/common';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/errors';
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
}
