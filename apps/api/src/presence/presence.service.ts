import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PresenceStore } from './presence-store.interface';
import { STALE_THRESHOLD_MS } from './presence-store.interface';
import { PRESENCE_ONLINE, PRESENCE_OFFLINE } from './presence-events';

/**
 * Presence service — business logic for presence operations.
 *
 * Handles connection lifecycle, heartbeats, and emits online/offline
 * events when a user's connection count transitions between 0 and 1.
 * Runs a periodic sweep to detect dirty disconnects (network drops,
 * crashes without graceful close).
 *
 * The service depends only on the `PresenceStore` port, not on the Redis
 * adapter directly (AGENTS.md section 2).
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: PresenceStore,
    private readonly events: EventEmitter2,
    @Optional() private readonly staleThresholdMs: number = STALE_THRESHOLD_MS,
  ) {}

  /**
   * Register a new connection for a user (called on authenticated WS connect).
   * Emits `presence_online` if this was the user's first connection.
   */
  async onConnect(userId: bigint, socketId: string): Promise<void> {
    const previousCount = await this.store.getConnectionCount(userId);
    await this.store.addConnection(userId, socketId);
    const newCount = await this.store.getConnectionCount(userId);

    // Transition 0 -> 1: user just came online
    if (previousCount === 0 && newCount === 1) {
      this.logger.debug(`User ${userId.toString()} came online`);
      this.events.emit(PRESENCE_ONLINE, { userId } satisfies {
        userId: bigint;
      });
    }
  }

  /**
   * Deregister a connection (called on clean WS disconnect).
   * Emits `presence_offline` if this was the user's last connection.
   */
  async onDisconnect(userId: bigint, socketId: string): Promise<void> {
    const previousCount = await this.store.getConnectionCount(userId);
    await this.store.removeConnection(userId, socketId);
    const newCount = await this.store.getConnectionCount(userId);

    // Transition 1 -> 0: user just went offline
    if (previousCount === 1 && newCount === 0) {
      this.logger.debug(`User ${userId.toString()} went offline`);
      this.events.emit(PRESENCE_OFFLINE, { userId } satisfies {
        userId: bigint;
      });
    }
  }

  /**
   * Touch a connection's last-active timestamp (called on socket.io pong).
   */
  async onHeartbeat(userId: bigint, socketId: string): Promise<void> {
    await this.store.touchConnection(userId, socketId);
  }

  /**
   * Get all currently online user IDs (for initial snapshot).
   */
  async getOnlineUserIds(): Promise<bigint[]> {
    return this.store.getOnlineUserIds();
  }

  /**
   * Periodic sweep for stale connections (dirty disconnects).
   * Finds connections not touched within the configured stale threshold and
   * calls onDisconnect for each, which emits offline if appropriate.
   */
  async sweepStaleConnections(): Promise<void> {
    try {
      const stale = await this.store.getStaleConnections(this.staleThresholdMs);

      for (const { userId, socketId } of stale) {
        this.logger.debug(
          `Sweeping stale connection: user=${userId.toString()}, socket=${socketId}`,
        );
        await this.onDisconnect(userId, socketId);
      }
    } catch (error) {
      this.logger.error(`Stale connection sweep failed: ${String(error)}`);
    }
  }

  onModuleInit(): void {
    // Skip sweep timer in test environments to avoid interfering with tests
    if (process.env.JEST_WORKER_ID !== undefined) {
      return;
    }

    // Run sweep every 10 seconds (presence-module.md section 3)
    this.sweepTimer = setInterval(
      () => void this.sweepStaleConnections(),
      10_000,
    );

    // Prevent the timer from keeping the process alive
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
