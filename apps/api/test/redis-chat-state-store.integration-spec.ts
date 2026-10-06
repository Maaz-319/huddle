import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisChatStateStore } from '../src/chat/adapters/redis-chat-state-store.adapter';
import {
  ChatStateStore,
  SEND_RETENTION_MS,
} from '../src/chat/chat-state-store.interface';
import { RedisService } from '../src/common/redis.service';
import {
  CHAT_STATE_CONTRACT_KEY_PREFIX,
  describeChatStateStoreContract,
} from './fakes/chat-state-store.contract';

/**
 * Reading process.env directly is correct here, for the same reason as in
 * prisma-test-client.ts: this is test infrastructure running outside the Nest
 * application, with no validated ConfigService in scope.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/** Keys this file writes directly, outside the shared contract. */
const PREFIX = 'huddle:chat:send:';

/** Every key the contract writes, identifiable inside the adapter's scheme. */
const CONTRACT_PATTERN = `${PREFIX}*:${CHAT_STATE_CONTRACT_KEY_PREFIX}*`;

describe('RedisChatStateStore', () => {
  let module: TestingModule;
  let redis: RedisService;
  let store: ChatStateStore;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: () => REDIS_URL } },
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
    // `npm run test:integration` passes twice in a row.
    const contractKeys = await redis.keys(CONTRACT_PATTERN);
    const ownKeys = await redis.keys(`${PREFIX}*:${PREFIX}*`);
    const all = [...contractKeys, ...ownKeys];
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

  describeChatStateStoreContract('RedisChatStateStore', (ttlMs) =>
    Promise.resolve(new RedisChatStateStore(redis, ttlMs)),
  );

  describe('behaviour that needs real Redis', () => {
    it('stores the ack as one JSON string with a millisecond expiry', async () => {
      const user = 9_990_001n;
      const key = `${PREFIX}shape`;

      await store.rememberSend(user, key, {
        messageId: '890123456789012345',
        createdAt: '2026-09-01T12:00:00.000Z',
      });

      const field = `${PREFIX}${user.toString()}:${key}`;
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
      const key = `${PREFIX}expiry`;
      const field = `${PREFIX}${user.toString()}:${key}`;

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
      const key = `${PREFIX}corrupt`;
      const field = `${PREFIX}${user.toString()}:${key}`;

      await redis.set(field, 'not json', 'PX', 30_000);

      await expect(store.recallSend(user, key)).resolves.toBeNull();
    });
  });
});
