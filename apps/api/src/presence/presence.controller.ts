import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MembershipRepository } from '../administration/membership-repository.interface';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../auth/user-repository.interface';
import { ParseSnowflakeArrayPipe } from '../common/parse-snowflake-array.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { PresenceService } from './presence.service';

/**
 * Presence REST endpoints — initial snapshot only.
 *
 * Live presence updates are pushed over WebSocket (see `ChatGateway`).
 */
@Controller()
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly memberships: MembershipRepository,
  ) {}

  /**
   * One-time presence snapshot for a set of user IDs.
   *
   * Called on client connect (or when opening a server) to get the current
   * online status for the relevant peer group (e.g., a server's member list).
   * After the snapshot, the client relies on live push updates to stay current.
   *
   * @param userIds - Comma-separated Snowflake ID strings
   * @returns `{ online: string[] }` — online IDs within the caller's peer set
   */
  @Get('presence/snapshot')
  @UseGuards(SessionAuthGuard)
  @RateLimit('read')
  async getSnapshot(
    @Query('userIds', ParseSnowflakeArrayPipe) userIds: bigint[],
    @CurrentUser() user: User,
  ): Promise<{ online: string[] }> {
    const peers = new Set(
      (await this.memberships.findUserIdsSharingServers(user.id)).map((id) =>
        id.toString(),
      ),
    );
    const authorizedIds = userIds.filter((id) => peers.has(id.toString()));
    const online = await this.presence.getOnlineUserIds(authorizedIds);

    const result = online.map((id) => id.toString());

    return { online: result };
  }
}
