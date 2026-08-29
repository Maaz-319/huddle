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
import { ServerRepository } from '../administration/server-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { isSnowflakeString } from '../common/snowflake.service';
import { REQUIRE_ROLE_KEY } from './require-role.decorator';
import { User } from './user-repository.interface';

/**
 * Enforces `@RequireRole`: the caller must hold one of the decorated roles in
 * the server named by the `:serverId` route param.
 *
 * Must run after `SessionAuthGuard` — it reads `request.user`, which only
 * `SessionAuthGuard` sets. Apply both together, in order:
 * `@UseGuards(SessionAuthGuard, RequireRoleGuard)`.
 *
 * Nest runs guards *before* pipes, so `ParseSnowflakePipe` has not parsed
 * `:serverId` yet when this guard runs — it validates and parses the raw
 * route param itself, the same way the pipe does, rather than trusting it.
 *
 * A null membership lookup is ambiguous by itself: it means either "you are
 * not a member of this server" or "this server does not exist" (a
 * nonexistent server has no membership rows for anyone). The two need
 * different responses (403 vs. 404, confirmed with the user), so on a null
 * lookup this guard checks `ServerRepository.findById` to tell them apart.
 */
@Injectable()
export class RequireRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipRepository,
    private readonly servers: ServerRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Coverage is opt-in: an undecorated route makes no membership lookup.
    if (roles === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const rawServerId = request.params.serverId;

    if (typeof rawServerId !== 'string' || !isSnowflakeString(rawServerId)) {
      throw new BadRequestException('Expected a Snowflake ID');
    }

    const serverId = BigInt(rawServerId);
    const membership = await this.memberships.findByServerAndUser(
      serverId,
      (request.user as User).id,
    );

    if (membership === null) {
      const server = await this.servers.findById(serverId);

      if (server === null) {
        throw new NotFoundError('Server not found', {
          serverId: rawServerId,
        });
      }

      throw new ForbiddenError('Insufficient role', { required: roles });
    }

    if (!roles.includes(membership.role)) {
      throw new ForbiddenError('Insufficient role', { required: roles });
    }

    return true;
  }
}
