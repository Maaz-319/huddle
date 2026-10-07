import { Injectable, Logger } from '@nestjs/common';
import { PresenceStore } from './presence-store.interface';

/**
 * Presence service — business logic for presence operations.
 *
 * Currently a minimal stub. Phase 9 issues #83 and #84 will add:
 * - Heartbeat/disconnect handling
 * - Presence broadcast to relevant clients
 * - Initial presence snapshot on client connect
 *
 * The service depends only on the `PresenceStore` port, not on the Redis
 * adapter directly (AGENTS.md section 2).
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly store: PresenceStore) {}

  /**
   * Register a new connection for a user (called on authenticated WS connect).
   */
  async addConnection(userId: bigint, socketId: string): Promise<void> {
    await this.store.addConnection(userId, socketId);
  }

  /**
   * Deregister a connection (called on clean WS disconnect).
   */
  async removeConnection(userId: bigint, socketId: string): Promise<void> {
    await this.store.removeConnection(userId, socketId);
  }

  /**
   * Get the number of active connections for a user.
   */
  async getConnectionCount(userId: bigint): Promise<number> {
    return this.store.getConnectionCount(userId);
  }

  /**
   * Get all currently online user IDs (for initial snapshot).
   */
  async getOnlineUserIds(): Promise<bigint[]> {
    return this.store.getOnlineUserIds();
  }

  /**
   * Touch a connection's last-active timestamp (called on socket.io pong).
   */
  async touchConnection(userId: bigint, socketId: string): Promise<void> {
    await this.store.touchConnection(userId, socketId);
  }

  /**
   * Get stale connections for dirty-disconnect sweep.
   */
  async getStaleConnections(
    thresholdMs: number,
  ): Promise<{ userId: bigint; socketId: string }[]> {
    return this.store.getStaleConnections(thresholdMs);
  }
}
