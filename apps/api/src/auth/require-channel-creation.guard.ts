import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  MembershipRepository,
  Role,
} from '../administration/membership-repository.interface';
import {
  Server,
  ServerRepository,
} from '../administration/server-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { isSnowflakeString } from '../common/snowflake.service';
import { REQUIRE_CHANNEL_CREATION_KEY } from './require-channel-creation.decorator';
import { User } from './user-repository.interface';

/**
 * Which roles each policy admits — administration-service.md section 3.
 *
 * Note `mods_only` includes the owner. A server's owner is never locked out
 * of their own server by a setting they control.
 */
const POLICY_ROLES: Record<Server['channelCreationPolicy'], Role[]> = {
  owner_only: ['owner'],
  mods_only: ['owner', 'moderator'],
  everyone: ['owner', 'moderator', 'member'],
};

/**
 * Enforces `@RequireChannelCreation`: the caller's role in the server named
 * by the `:serverId` route param must be one the server's own
 * `channelCreationPolicy` admits.
 *
 * Must run after `SessionAuthGuard` — it reads `request.user`, which only
 * `SessionAuthGuard` sets. Apply both together, in order:
 * `@UseGuards(SessionAuthGuard, RequireChannelCreationGuard)`.
 *
 * Nest runs guards *before* pipes, so `ParseSnowflakePipe` has not parsed
 * `:serverId` yet when this guard runs — it validates and parses the raw
 * route param itself, the same way the pipe does, rather than trusting it.
 *
 * Unlike `RequireRoleGuard` this always loads the server, because the policy
 * lives on that row. Loading it first also settles the 403-vs-404 question
 * `RequireRoleGuard` has to make a second query for: an unknown server is a
 * 404 for everyone, and only then is a missing membership a 403.
 */
@Injectable()
export class RequireChannelCreationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipRepository,
    private readonly servers: ServerRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_CHANNEL_CREATION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Coverage is opt-in: an undecorated route makes no lookup at all.
    if (required !== true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const rawServerId = request.params.serverId;

    if (typeof rawServerId !== 'string' || !isSnowflakeString(rawServerId)) {
      throw new BadRequestException('Expected a Snowflake ID');
    }

    const serverId = BigInt(rawServerId);
    const server = await this.servers.findById(serverId);

    if (server === null) {
      throw new NotFoundError('Server not found', { serverId: rawServerId });
    }

    const membership = await this.memberships.findByServerAndUser(
      serverId,
      (request.user as User).id,
    );

    if (membership === null) {
      throw new ForbiddenError('Insufficient role', {
        required: POLICY_ROLES[server.channelCreationPolicy],
      });
    }

    const allowed = POLICY_ROLES[server.channelCreationPolicy];

    if (!allowed.includes(membership.role)) {
      throw new ForbiddenError('Insufficient role', { required: allowed });
    }

    return true;
  }
}
