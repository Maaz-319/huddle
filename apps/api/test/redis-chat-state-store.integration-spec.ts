import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisChatStateStore } from '../src/chat/adapters/redis-chat-state-store.adapter';
import {
  ChatStateStore,
  SEND_RETENTION_MS,
  TYPING_DEBOUNCE_MS,
  VIOLATION_WINDOW_MS,
} from '../src/chat/chat-state-store.interface';
import { RedisService } from '../src/common/redis.service';
import { LoggerService } from '../src/common/logger.service';
import {
  CHAT_STATE_CONTRACT_KEY_PREFIX,
  CHAT_STATE_CONTRACT_TYPING_PATTERN,
  CHAT_STATE_CONTRACT_VIOLATIONS_PATTERN,
  describeChatStateStoreContract,
} from './fakes/chat-state-store.contract';

/**
 * Reading process.env directly is correct here, for the same reason as in
 * prisma-test-client.ts: this is test infrastructure running outside the Nest
 * application, with no validated ConfigService in scope.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/** The send scheme; the direct-write cases below compose keys inside it. */
const SEND_PREFIX = 'huddle:chat:send:';

/**
 * Every nonce-bearing scheme this file writes, one per op that composes keys
 * with a `:<nonce>` segment. The violation counter has no nonce (it is keyed
 * by user alone) and so is swept by `CHAT_STATE_CONTRACT_VIOLATIONS_PATTERN`
 * instead — its `99*` user glob also covers the hand-picked ids the
 * real-Redis cases below use.
 */
const PREFIXES = [
  'huddle:chat:send:',
  'huddle:chat:edit:',
  'huddle:chat:delete:',
] as const;

/**
 * Every key the contract writes, whatever operation wrote it: the adapter
 * composes `huddle:chat:<op>:<user>:<nonce>` and the contract's prefix sits
 * inside the `:<nonce>` segment.
 */
const CONTRACT_PATTERN = `huddle:chat:*:*:${CHAT_STATE_CONTRACT_KEY_PREFIX}*`;

describe('RedisChatStateStore', () => {
  let module: TestingModule;
  let redis: RedisService;
  let store: ChatStateStore;

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
        { provide: ChatStateStore, useClass: RedisChatStateStore },
      ],
    }).compile();

    await module.init();
    redis = module.get(RedisService);
    store = module.get(ChatStateStore);
    await redis.ping();
  });

  afterEach(async () => {
    // Scoped to exactly what this file writes — contract keys are told apart
    // by the contract's prefix sitting inside the adapter's `:<key>` segment
    // — so a development idempotency key is never swept up, and
    // `npm run test:integration` passes twice in a row. Typing flags and
    // violation counters have no prefixed nonce to hang off, so they match on
    // the contract's `99*` user floor instead
    // (CHAT_STATE_CONTRACT_TYPING_PATTERN, CHAT_STATE_CONTRACT_VIOLATIONS_PATTERN).
    const contractKeys = await redis.keys(CONTRACT_PATTERN);
    const typingKeys = await redis.keys(CHAT_STATE_CONTRACT_TYPING_PATTERN);
    const violationKeys = await redis.keys(
      CHAT_STATE_CONTRACT_VIOLATIONS_PATTERN,
    );
    const ownKeys: string[] = [];
    for (const prefix of PREFIXES) {
      ownKeys.push(...(await redis.keys(`${prefix}*:${prefix}*`)));
    }
    const all = [...contractKeys, ...typingKeys, ...violationKeys, ...ownKeys];
    if (all.length > 0) await redis.del(...all);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port token to the Redis adapter', () => {
    // The `{ provide: ChatStateStore, useClass: RedisChatStateStore }` binding
    // in chat.module.ts is the whole pattern; this asserts an abstract class
    // really does work as a DI token, which a TS interface would not.
    expect(store).toBeInstanceOf(RedisChatStateStore);
  });

  describeChatStateStoreContract(
    'RedisChatStateStore',
    (ttlMs, debounceMs, violationWindowMs) =>
      Promise.resolve(
        new RedisChatStateStore(redis, ttlMs, debounceMs, violationWindowMs),
      ),
  );

  describe('behaviour that needs real Redis', () => {
    it('stores the ack as one JSON string with a millisecond expiry', async () => {
      const user = 9_990_001n;
      const key = `${SEND_PREFIX}shape`;

      await store.rememberSend(user, key, {
        messageId: '890123456789012345',
        createdAt: '2026-09-01T12:00:00.000Z',
      });

      const field = `${SEND_PREFIX}${user.toString()}:${key}`;
      await expect(redis.type(field)).resolves.toBe('string');
      await expect(redis.get(field)).resolves.toBe(
        JSON.stringify({
          messageId: '890123456789012345',
          createdAt: '2026-09-01T12:00:00.000Z',
        }),
      );

      const ttl = await redis.pttl(field);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(SEND_RETENTION_MS);
    });

    it('drops a value once the retention window passes', async () => {
      const shortLived = new RedisChatStateStore(redis, 300);
      const user = 9_990_002n;
      const key = `${SEND_PREFIX}expiry`;
      const field = `${SEND_PREFIX}${user.toString()}:${key}`;

      await shortLived.rememberSend(user, key, {
        messageId: '890123456789012346',
        createdAt: '2026-09-01T12:00:01.000Z',
      });
      await expect(redis.exists(field)).resolves.toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Gone, not merely stale — and a value that is gone is a miss, which
      // is the safe direction to fail in (AGENTS.md section 8).
      await expect(redis.exists(field)).resolves.toBe(0);
      await expect(store.recallSend(user, key)).resolves.toBeNull();
    });

    it('treats a value that is not JSON as a miss rather than crashing', async () => {
      const user = 9_990_003n;
      const key = `${SEND_PREFIX}corrupt`;
      const field = `${SEND_PREFIX}${user.toString()}:${key}`;

      await redis.set(field, 'not json', 'PX', 30_000);

      await expect(store.recallSend(user, key)).resolves.toBeNull();
    });

    it('files the typing flag as a millisecond-expiry key under the typing namespace', async () => {
      const user = 9_990_004n;
      const channel = 42_424_242n;
      const field = `huddle:chat:typing:${user.toString()}:${channel.toString()}`;

      await expect(store.markTyping(user, channel)).resolves.toBe(true);
      await expect(redis.type(field)).resolves.toBe('string');

      const ttl = await redis.pttl(field);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(TYPING_DEBOUNCE_MS);

      // The NX half against real Redis: the second call loses the same way
      // the contract's drop case says it must.
      await expect(store.markTyping(user, channel)).resolves.toBe(false);
    });

    it('files the violation counter as one integer key with the default 60s window', async () => {
      const user = 9_990_005n;
      const field = `huddle:chat:violations:${user.toString()}`;

      await expect(store.recordViolation(user)).resolves.toBe(1);
      await expect(redis.type(field)).resolves.toBe('string');
      await expect(redis.get(field)).resolves.toBe('1');

      // The default window is the port's documented 60 seconds
      // (VIOLATION_WINDOW_MS) — asserted against real Redis because that is
      // where a wrong unit (seconds where milliseconds were meant, say)
      // would silently give every flood 60x its intended runway.
      const ttl = await redis.pttl(field);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(VIOLATION_WINDOW_MS);
      expect(ttl).toBeGreaterThan(VIOLATION_WINDOW_MS - 2_000);

      await expect(store.recordViolation(user)).resolves.toBe(2);
      await expect(redis.get(field)).resolves.toBe('2');
    });
  });
});
