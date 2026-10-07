import { Injectable, Optional } from '@nestjs/common';
import type { ClientContext, Result } from 'ioredis';
import { RedisService } from '../../common/redis.service';
import {
  PresenceStore,
  StaleConnection,
  HEARTBEAT_WINDOW_MS,
  STALE_THRESHOLD_MS,
} from '../presence-store.interface';

/**
 * Teaches TypeScript about the command `defineCommand` installs at runtime,
 * augmenting ioredis's `RedisCommander` exactly the way the rate-limit
 * adapter's script does — the documented way to do this, and what keeps the
 * call site free of a cast (AGENTS.md section 4). Two files may declare it;
 * the interface declarations merge.
 */
declare module 'ioredis' {
  interface RedisCommander<
    Context extends ClientContext = { type: 'default' },
  > {
    huddlePresenceTouch(
      connectionsKey: string,
      onlineUsersKey: string,
      socketId: string,
      nowMs: string,
      windowMs: string,
    ): Result<unknown, Context>;

    huddlePresenceAddConnection(
      connectionsKey: string,
      onlineUsersKey: string,
      socketId: string,
      nowMs: string,
      windowMs: string,
    ): Result<unknown, Context>;

    huddlePresenceRemoveConnection(
      connectionsKey: string,
      onlineUsersKey: string,
      socketId: string,
    ): Result<unknown, Context>;
  }
}

/**
 * Atomic touch: update last-touch for a socket, refresh TTL on the connections
 * hash, and ensure the user is in the online-users set.
 *
 * KEYS[1] = connections hash (huddle:presence:connections:<userId>)
 * KEYS[2] = online-users set (huddle:presence:online-users)
 * ARGV[1] = socketId
 * ARGV[2] = nowMs (epoch milliseconds)
 * ARGV[3] = windowMs (heartbeat window + buffer for TTL)
 */
const TOUCH_SCRIPT = `
-- If the socket doesn't exist in the hash, do nothing (race with clean disconnect)
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  return 0
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SADD', KEYS[2], KEYS[1]:match(':(%d+)$') or '0') -- extract userId from connections key
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

/**
 * Atomic add: set socket in connections hash with timestamp, add user to online set.
 * Idempotent: if socket exists, updates timestamp.
 */
const ADD_CONNECTION_SCRIPT = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SADD', KEYS[2], KEYS[1]:match(':(%d+)$') or '0')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

/**
 * Atomic remove: delete socket from connections hash. If hash becomes empty,
 * remove user from online-users set.
 */
const REMOVE_CONNECTION_SCRIPT = `
local remaining = redis.call('HDEL', KEYS[1], ARGV[1])
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('SREM', KEYS[2], KEYS[1]:match(':(%d+)$') or '0')
end
return remaining
`;

/**
 * Redis-backed presence connection registry.
 *
 * The only file in `src/presence/` that may inject `RedisService`
 * (AGENTS.md section 2) — that confinement is what keeps the port swappable.
 * `RedisService` comes from the `@Global()` `CommonModule`, so the module needs
 * no import for it.
 *
 * Key scheme:
 * - Connections hash: `huddle:presence:connections:<userId>` → field=socketId, value=lastTouchMs (epoch ms)
 * - Online users set: `huddle:presence:online-users` → member=userId as string
 *
 * TTL on the connections hash matches `heartbeatWindowMs`. The
 * online-users set has no TTL — membership is maintained atomically by the
 * add/remove/touch scripts.
 *
 * `heartbeatWindowMs` and `staleThresholdMs` are constructor parameters
 * defaulting to the port's documented constants. They are injectable so a test
 * can shrink a window and assert the "after the window" half of an expiry AC
 * without sleeping the real duration.
 *
 * Losing a value — eviction, restart, expiry — yields `0` for connection count,
 * absence from `getOnlineUserIds`, which is the safe direction: at worst one
 * user appears offline until their next reconnect, exactly the failure mode
 * AGENTS.md section 8 declares acceptable for everything Redis holds here.
 */
@Injectable()
export class RedisPresenceStore extends PresenceStore {
  constructor(
    private readonly redis: RedisService,
    @Optional() public heartbeatWindowMs: number = HEARTBEAT_WINDOW_MS,
    @Optional() public staleThresholdMs: number = STALE_THRESHOLD_MS,
  ) {
    super();

    this.redis.defineCommand('huddlePresenceTouch', {
      numberOfKeys: 2,
      lua: TOUCH_SCRIPT,
    });
    this.redis.defineCommand('huddlePresenceAddConnection', {
      numberOfKeys: 2,
      lua: ADD_CONNECTION_SCRIPT,
    });
    this.redis.defineCommand('huddlePresenceRemoveConnection', {
      numberOfKeys: 2,
      lua: REMOVE_CONNECTION_SCRIPT,
    });
  }

  private connectionsKey(userId: bigint): string {
    return `huddle:presence:connections:${userId.toString()}`;
  }

  private onlineUsersKey(): string {
    return 'huddle:presence:online-users';
  }

  async addConnection(userId: bigint, socketId: string): Promise<void> {
    const now = Date.now();
    await this.redis.huddlePresenceAddConnection(
      this.connectionsKey(userId),
      this.onlineUsersKey(),
      socketId,
      String(now),
      String(this.heartbeatWindowMs),
    );
  }

  async removeConnection(userId: bigint, socketId: string): Promise<void> {
    await this.redis.huddlePresenceRemoveConnection(
      this.connectionsKey(userId),
      this.onlineUsersKey(),
      socketId,
    );
  }

  async getConnectionCount(userId: bigint): Promise<number> {
    const len = await this.redis.hlen(this.connectionsKey(userId));
    return len;
  }

  async getOnlineUserIds(): Promise<bigint[]> {
    const members = await this.redis.smembers(this.onlineUsersKey());
    const online: bigint[] = [];

    for (const member of members) {
      const userId = BigInt(member);
      const count = await this.redis.hlen(this.connectionsKey(userId));
      if (count > 0) {
        online.push(userId);
      } else {
        // Stale entry in online-users set (hash expired) — clean it up
        await this.redis.srem(this.onlineUsersKey(), member);
      }
    }

    return online;
  }

  async touchConnection(userId: bigint, socketId: string): Promise<void> {
    const now = Date.now();
    await this.redis.huddlePresenceTouch(
      this.connectionsKey(userId),
      this.onlineUsersKey(),
      socketId,
      String(now),
      String(this.heartbeatWindowMs),
    );
  }

  async getStaleConnections(thresholdMs: number): Promise<StaleConnection[]> {
    const onlineUsers = await this.redis.smembers(this.onlineUsersKey());
    const now = Date.now();
    const stale: StaleConnection[] = [];

    // For each online user, check their connections
    for (const userStr of onlineUsers) {
      const userId = BigInt(userStr);
      const connections = await this.redis.hgetall(this.connectionsKey(userId));

      if (Object.keys(connections).length === 0) {
        // Hash expired — clean up stale online-users entry
        await this.redis.srem(this.onlineUsersKey(), userStr);
        continue;
      }

      for (const [socketId, lastTouchStr] of Object.entries(connections)) {
        const lastTouch = Number(lastTouchStr);
        if (now - lastTouch >= thresholdMs) {
          stale.push({ userId, socketId });
        }
      }
    }

    return stale;
  }
}
