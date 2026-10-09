import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisPresenceStore } from '../src/presence/adapters/redis-presence-store.adapter';
import {
  PresenceStore,
  HEARTBEAT_WINDOW_MS,
} from '../src/presence/presence-store.interface';
import { RedisService } from '../src/common/redis.service';
import { LoggerService } from '../src/common/logger.service';
import {
  DEFAULT_HEARTBEAT_MS,
  EXPIRY_HEARTBEAT_MS,
  STALE_TEST_THRESHOLD_MS,
  describePresenceStoreContract,
} from './fakes/presence-store.contract';

/**
 * Reading process.env directly is correct here, for the same reason as in
 * prisma-test-client.ts: this is test infrastructure running outside the Nest
 * application, with no validated ConfigService in scope.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/** Key patterns for cleanup between tests. */
const CONNECTIONS_PREFIX = 'huddle:presence:connections:';
const ONLINE_USERS_KEY = 'huddle:presence:online-users';

describe('RedisPresenceStore', () => {
  let module: TestingModule;
  let redis: RedisService;
  let store: PresenceStore;

  beforeAll(async () => {
    const mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      setCorrelationId: jest.fn(),
      clearCorrelationId: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService;

    module = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: () => REDIS_URL } },
        { provide: LoggerService, useValue: mockLogger },
        { provide: PresenceStore, useClass: RedisPresenceStore },
      ],
    }).compile();

    await module.init();
    redis = module.get(RedisService);
    store = module.get(PresenceStore);
    await redis.ping();
  });

  afterEach(async () => {
    // Clean up exactly what this file writes — contract keys use the 99* user floor
    // so they match the CONNECTIONS_PREFIX:99* pattern, and the online-users set
    // is cleaned by removing those same user ids.
    const contractKeys = await redis.keys(`${CONNECTIONS_PREFIX}99*`);
    if (contractKeys.length > 0) await redis.del(...contractKeys);

    // Clean online-users set: remove any 99* members
    const onlineUsers = await redis.smembers(ONLINE_USERS_KEY);
    const contractUsers = onlineUsers.filter((u) => u.startsWith('99'));
    if (contractUsers.length > 0)
      await redis.srem(ONLINE_USERS_KEY, ...contractUsers);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port token to the Redis adapter', () => {
    // The `{ provide: PresenceStore, useClass: RedisPresenceStore }` binding
    // in presence.module.ts is the whole pattern; this asserts an abstract class
    // really does work as a DI token, which a TS interface would not.
    expect(store).toBeInstanceOf(RedisPresenceStore);
  });

  describePresenceStoreContract(
    'RedisPresenceStore',
    (heartbeatMs, staleThresholdMs) =>
      Promise.resolve(
        new RedisPresenceStore(redis, heartbeatMs, staleThresholdMs),
      ),
  );

  describe('behaviour that needs real Redis', () => {
    it('stores the connection as a hash field with millisecond timestamp and TTL', async () => {
      const user = 9_990_001n;
      const socket = 'socket-shape-test';

      await store.addConnection(user, socket);

      const key = `${CONNECTIONS_PREFIX}${user.toString()}`;
      await expect(redis.type(key)).resolves.toBe('hash');
      const field = await redis.hget(key, socket);
      expect(field).not.toBeNull();
      expect(Number(field!)).toBeGreaterThan(0);

      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(HEARTBEAT_WINDOW_MS + 5000);
    });

    it('adds the user to the online-users set on first connection', async () => {
      const user = 9_990_002n;
      const socket = 'socket-online-test';

      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(0);

      await store.addConnection(user, socket);

      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(1);
    });

    it('removes the user from online-users set when last connection is removed', async () => {
      const user = 9_990_003n;
      const socket = 'socket-remove-last';

      await store.addConnection(user, socket);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(1);

      await store.removeConnection(user, socket);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(0);
    });

    it('keeps user in online-users set when other connections remain', async () => {
      const user = 9_990_004n;
      const socketA = 'socket-multi-a';
      const socketB = 'socket-multi-b';

      await store.addConnection(user, socketA);
      await store.addConnection(user, socketB);

      await store.removeConnection(user, socketA);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(1);
      await expect(store.getConnectionCount(user)).resolves.toBe(1);

      await store.removeConnection(user, socketB);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(0);
    });

    it('drops a connection once the heartbeat window passes', async () => {
      const shortStore = new RedisPresenceStore(redis, EXPIRY_HEARTBEAT_MS);
      const user = 9_990_005n;
      const socket = 'socket-expiry';
      const key = `${CONNECTIONS_PREFIX}${user.toString()}`;

      await shortStore.addConnection(user, socket);
      await expect(redis.hexists(key, socket)).resolves.toBe(1);

      await new Promise((resolve) =>
        setTimeout(resolve, EXPIRY_HEARTBEAT_MS * 2),
      );

      // Gone — key expired, so hash is empty
      await expect(redis.exists(key)).resolves.toBe(0);
      // Lazy cleanup: getOnlineUserIds removes stale online-users entries
      await expect(shortStore.getOnlineUserIds()).resolves.not.toContain(user);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(0);
      await expect(shortStore.getConnectionCount(user)).resolves.toBe(0);
    });

    it('touchConnection refreshes the timestamp and TTL', async () => {
      const heartbeatStore = new RedisPresenceStore(redis, EXPIRY_HEARTBEAT_MS);
      const user = 9_990_006n;
      const socket = 'socket-touch';
      const key = `${CONNECTIONS_PREFIX}${user.toString()}`;

      await heartbeatStore.addConnection(user, socket);
      const initialTouch = await redis.hget(key, socket);
      await expect(redis.pttl(key)).resolves.toBeGreaterThan(0);

      // Wait past half the window, then touch
      await new Promise((resolve) =>
        setTimeout(resolve, EXPIRY_HEARTBEAT_MS / 2),
      );
      await heartbeatStore.touchConnection(user, socket);

      // Timestamp should have increased
      const touchedTouch = await redis.hget(key, socket);
      expect(Number(touchedTouch!)).toBeGreaterThan(Number(initialTouch!));

      // TTL should have been refreshed (roughly back to full window)
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(EXPIRY_HEARTBEAT_MS / 2);

      // Wait full window from touch — should be gone
      await new Promise((resolve) => setTimeout(resolve, EXPIRY_HEARTBEAT_MS));
      await expect(redis.exists(key)).resolves.toBe(0);
    });

    it('touchConnection is a no-op for non-existent connection', async () => {
      const user = 9_990_007n;
      const socket = 'socket-touch-missing';

      // Should not throw
      await expect(
        store.touchConnection(user, socket),
      ).resolves.toBeUndefined();
      await expect(store.getConnectionCount(user)).resolves.toBe(0);
    });

    it('getStaleConnections finds connections older than threshold', async () => {
      const staleStore = new RedisPresenceStore(
        redis,
        DEFAULT_HEARTBEAT_MS,
        STALE_TEST_THRESHOLD_MS,
      );
      const user = 9_990_008n;
      const socket = 'socket-stale';

      await staleStore.addConnection(user, socket);
      await expect(
        redis.sismember(ONLINE_USERS_KEY, user.toString()),
      ).resolves.toBe(1);

      // Wait past the stale threshold
      await new Promise((resolve) =>
        setTimeout(resolve, STALE_TEST_THRESHOLD_MS + 50),
      );

      const stale = await staleStore.getStaleConnections(
        STALE_TEST_THRESHOLD_MS,
      );
      expect(stale).toHaveLength(1);
      expect(stale[0]).toEqual({ userId: user, socketId: socket });
    });

    it('getStaleConnections returns empty when all connections are fresh', async () => {
      const user = 9_990_009n;
      const socket = 'socket-fresh';

      await store.addConnection(user, socket);

      const stale = await store.getStaleConnections(STALE_TEST_THRESHOLD_MS);
      expect(stale).toHaveLength(0);
    });

    it('getStaleConnections scopes per connection: one stale, one fresh', async () => {
      const staleStore = new RedisPresenceStore(
        redis,
        DEFAULT_HEARTBEAT_MS,
        STALE_TEST_THRESHOLD_MS,
      );
      const user = 9_990_010n;
      const staleSocket = 'socket-stale-multi';
      const freshSocket = 'socket-fresh-multi';

      await staleStore.addConnection(user, staleSocket);
      await new Promise((resolve) =>
        setTimeout(resolve, STALE_TEST_THRESHOLD_MS + 50),
      );
      await staleStore.addConnection(user, freshSocket);

      const stale = await staleStore.getStaleConnections(
        STALE_TEST_THRESHOLD_MS,
      );
      expect(stale).toHaveLength(1);
      expect(stale[0]).toEqual({ userId: user, socketId: staleSocket });
    });
  });
});
