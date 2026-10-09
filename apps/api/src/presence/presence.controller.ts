import { Controller, Get, Query } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { ParseSnowflakeArrayPipe } from '../common/parse-snowflake-array.pipe';

/**
 * Presence REST endpoints — initial snapshot only.
 *
 * Live presence updates are pushed over WebSocket (see `ChatGateway`).
 */
@Controller()
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /**
   * One-time presence snapshot for a set of user IDs.
   *
   * Called on client connect (or when opening a server) to get the current
   * online status for the relevant peer group (e.g., a server's member list).
   * After the snapshot, the client relies on live push updates to stay current.
   *
   * @param userIds - Comma-separated Snowflake ID strings
   * @returns `{ online: string[] }` — subset of requested IDs that are currently online
   */
  @Get('presence/snapshot')
  async getSnapshot(
    @Query('userIds', ParseSnowflakeArrayPipe) userIds: bigint[],
  ): Promise<{ online: string[] }> {
    const online = await this.presence.getOnlineUserIds();
    const onlineSet = new Set(online.map((id) => id.toString()));

    const result = userIds
      .filter((id) => onlineSet.has(id.toString()))
      .map((id) => id.toString());

    return { online: result };
  }
}
