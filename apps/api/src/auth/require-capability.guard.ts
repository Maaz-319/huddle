import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ChannelMemberRepository } from '../administration/channel-member-repository.interface';
import {
  Capability,
  ChannelOverrideRepository,
} from '../administration/channel-override-repository.interface';
import { ChannelRepository } from '../administration/channel-repository.interface';
import { MembershipRepository } from '../administration/membership-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { isSnowflakeString } from '../common/snowflake.service';
import { REQUIRE_CAPABILITY_KEY } from './require-capability.decorator';
import { CapabilityDecision, resolveCapability } from './resolve-capability';
import { User } from './user-repository.interface';

/**
 * Enforces `@RequireCapability`: the caller must hold the decorated
 * capability in the channel named by the `:channelId` route param.
 *
 * Must run after `SessionAuthGuard` — it reads `request.user`, which only
 * `SessionAuthGuard` sets. Apply both together, in order:
 * `@UseGuards(SessionAuthGuard, RequireCapabilityGuard)`.
 *
 * Nest runs guards *before* pipes, so `ParseSnowflakePipe` has not parsed
 * `:channelId` yet when this guard runs — it validates and parses the raw
 * route param itself, the same way the pipe does.
 *
 * The channel is loaded *first*, and the membership second, because there is
 * no `:serverId` on these routes: `channel.serverId` is what the membership
 * lookup keys on. `RequireRoleGuard` cannot guard them for the same reason.
 *
 * This guard does no rule arithmetic. It loads, calls `resolveCapability`,
 * and turns the decision into an error — the rules live in that one function
 * so that #54's channel-list filter decides identically.
 *
 * **Several outcomes here are 404 where a first reading would expect 403**,
 * and they all render byte-identically to "no such channel":
 *
 * - not a member of the channel's server — a non-member must not learn that a
 *   given channel id exists;
 * - a private channel the caller holds no `ChannelMember` row for — a private
 *   channel is *fully hidden* (administration-service.md section 3);
 * - **any refusal of `view` at all**, including one caused by an override.
 *   This last one goes beyond #51's literal step 6, deliberately: once #54
 *   filters a `view`-revoked channel out of the listing, a 403 on direct
 *   access would confirm the existence of a channel the caller can never see
 *   listed — a weaker version of exactly the leak the rule above prevents. A
 *   capability the caller cannot use to see the channel should not be able to
 *   tell them it is there.
 *
 * Non-`view` capabilities keep their 403: by the time a caller is asking to
 * post or to manage settings, they can already see the channel, so there is
 * nothing left to hide.
 */
@Injectable()
export class RequireCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly channels: ChannelRepository,
    private readonly memberships: MembershipRepository,
    private readonly channelMembers: ChannelMemberRepository,
    private readonly overrides: ChannelOverrideRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<Capability | undefined>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Coverage is opt-in: an undecorated route makes no lookup at all.
    if (capability === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const rawChannelId = request.params.channelId;

    if (typeof rawChannelId !== 'string' || !isSnowflakeString(rawChannelId)) {
      throw new BadRequestException('Expected a Snowflake ID');
    }

    const channelId = BigInt(rawChannelId);
    const userId = (request.user as User).id;

    const channel = await this.channels.findById(channelId);

    if (channel === null) throw this.hidden(rawChannelId);

    const membership = await this.memberships.findByServerAndUser(
      channel.serverId,
      userId,
    );

    // 404, not 403: a non-member of the server must not learn the id exists.
    if (membership === null) throw this.hidden(rawChannelId);

    // The owner short-circuits before either channel-scoped table is read.
    // Asserted in the spec, because it is a rule (PRD section 5) and not
    // merely an optimisation.
    if (membership.role === 'owner') return true;

    const [isChannelMember, overrides] = await Promise.all([
      channel.isPrivate
        ? this.channelMembers.isMember(channelId, userId)
        : Promise.resolve(false),
      this.overrides.findByChannelId(channelId),
    ]);

    const decision = resolveCapability(
      {
        role: membership.role,
        isPrivate: channel.isPrivate,
        isChannelMember,
        overrides,
      },
      capability,
    );

    if (decision.allowed) return true;

    throw this.refusal(decision, capability, rawChannelId);
  }

  /**
   * The one 404 every hiding case shares. The body must be identical across
   * all of them — a differing message or `details` would make the 404 an
   * existence oracle again, defeating the point of returning one.
   */
  private hidden(channelId: string): NotFoundError {
    return new NotFoundError('Channel not found', { channelId });
  }

  private refusal(
    decision: Extract<CapabilityDecision, { allowed: false }>,
    capability: Capability,
    channelId: string,
  ): NotFoundError | ForbiddenError {
    switch (decision.reason) {
      case 'hidden':
        return this.hidden(channelId);
      case 'role-default':
      case 'override':
        // See the class doc: a refused `view` hides the channel rather than
        // admitting it exists.
        return capability === 'view'
          ? this.hidden(channelId)
          : new ForbiddenError('Insufficient capability', { capability });
      default: {
        // A declaration, not a cast -- if CapabilityDecision grows a reason
        // this stops compiling. AGENTS.md section 4 bans `as never`; this is
        // the opposite of that, and the reason it looks similar.
        const unreachable: never = decision;

        return unreachable;
      }
    }
  }
}
