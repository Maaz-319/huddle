import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../src/common/redis.service';
import { RedisRateLimitStore } from '../src/rate-limiter/adapters/redis-rate-limit-store.adapter';
import { RateLimitStore } from '../src/rate-limiter/rate-limit-store.interface';
import {
  CONTRACT_KEY_PREFIX,
  describeRateLimitStoreContract,
} from './fakes/rate-limit-store.contract';

/**
 * Reading process.env directly is correct here, for the same reason as in
 * prisma-test-client.ts: this is test infrastructure running outside the Nest
 * application, with no validated ConfigService in scope.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/** Keys this file writes directly, outside the shared contract. */
const PREFIX = 'huddle:test:redis-rate-limit:';

/** An arbitrary fixed epoch, as in the contract. */
const START_MS = 1_700_000_000_000;

/**
 * The Redis token bucket against the real Docker Redis.
 *
 * The bulk of this file is one line: the same contract the fake is held to, run
 * against the adapter. Without it the fake is a false sense of safety — it
 * would prove the port is usable, not that Redis actually behaves that way
 * (docs/architecture/repo-structure.md section 6).
 *
 * The cases below the contract are the ones a `Map` cannot express, and the
 * first of them is the reason the script is a script at all.
 */
describe('RedisRateLimitStore', () => {
  let module: TestingModule;
  let redis: RedisService;
  let store: RateLimitStore;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: () => REDIS_URL } },
        { provide: RateLimitStore, useClass: RedisRateLimitStore },
      ],
    }).compile();

    await module.init();
    redis = module.get(RedisService);
    store = module.get(RateLimitStore);
    await redis.ping();
  });

  afterEach(async () => {
    // Everything written here lives under one of two prefixes and is deleted
    // between cases, so `npm run test:integration` passes twice in a row and
    // nothing here can collide with a development key.
    const keys = await redis.keys(`${PREFIX}*`);
    const contractKeys = await redis.keys(`${CONTRACT_KEY_PREFIX}*`);
    const all = [...keys, ...contractKeys];
    if (all.length > 0) await redis.del(...all);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port token to the Redis adapter', () => {
    // The `{ provide: RateLimitStore, useClass: RedisRateLimitStore }` binding
    // in rate-limiter.module.ts is the whole pattern; this asserts an abstract
    // class really does work as a DI token, which a TS interface would not.
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });

  describeRateLimitStoreContract('RedisRateLimitStore', () =>
    Promise.resolve(store),
  );

  describe('behaviour that needs real Redis', () => {
    it('allows exactly capacity when the whole burst arrives at once', async () => {
      const key = `${PREFIX}atomicity`;
      const capacity = 10;

      // The point of the Lua script. Issued concurrently, a read-modify-write
      // implementation would have several of these read the same token count,
      // all decide they may spend, and all spend it — letting more than
      // `capacity` through. Nothing but running the whole check-and-consume
      // inside Redis makes this number exact.
      const results = await Promise.all(
        Array.from({ length: capacity + 5 }, () =>
          store.consume({
            key,
            capacity,
            refillPerSecond: 1,
            cost: 1,
            nowMs: START_MS,
          }),
        ),
      );

      const allowed = results.filter((result) => result.allowed);

      expect(allowed).toHaveLength(capacity);
    });

    it('puts a TTL on a bucket, long enough to cover refilling to full', async () => {
      const key = `${PREFIX}ttl`;

      await store.consume({
        key,
        capacity: 5,
        refillPerSecond: 1,
        cost: 5,
        nowMs: START_MS,
      });

      // Emptied at one token per second, so five seconds of refill plus the
      // script's one-second margin. An idle bucket that never expired would
      // accumulate forever, and every Redis key in Huddle is ephemeral by
      // design (AGENTS.md section 8).
      const ttl = await redis.pttl(key);

      expect(ttl).toBeGreaterThan(5000);
      expect(ttl).toBeLessThanOrEqual(6000);
    });

    it('drops the bucket once it would have refilled to full', async () => {
      const key = `${PREFIX}expiry`;

      // A bucket that refills almost instantly, so its TTL is the script's
      // one-second floor rather than a wait this test has to sit through.
      await store.consume({
        key,
        capacity: 1,
        refillPerSecond: 1000,
        cost: 1,
        nowMs: START_MS,
      });

      await expect(redis.exists(key)).resolves.toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Gone, not merely stale — and a bucket that is gone is a full one, which
      // is the safe direction to fail in
      // (docs/architecture/rate-limiter.md section 2).
      await expect(redis.exists(key)).resolves.toBe(0);
    });

    it('stores the token count and last refill time as one hash', async () => {
      const key = `${PREFIX}shape`;

      await store.consume({
        key,
        capacity: 5,
        refillPerSecond: 1,
        cost: 2,
        nowMs: START_MS,
      });

      // The documented storage shape: one hash per bucket holding the token
      // count and the timestamp it was last refilled from
      // (docs/architecture/rate-limiter.md section 2).
      await expect(redis.type(key)).resolves.toBe('hash');
      await expect(redis.hget(key, 'tokens')).resolves.toBe('3');
      await expect(redis.hget(key, 'updatedAt')).resolves.toBe(
        String(START_MS),
      );
    });

    it('survives Redis losing its script cache', async () => {
      const key = `${PREFIX}noscript`;

      await store.consume({
        key,
        capacity: 5,
        refillPerSecond: 1,
        cost: 1,
        nowMs: START_MS,
      });

      // A restarted Redis has an empty script cache, and EVALSHA then answers
      // NOSCRIPT. `defineCommand` retries with the full script body; if the
      // adapter had called `evalsha` by hand without that fallback, every
      // rate-limited request would start failing after a restart.
      await redis.script('FLUSH');

      await expect(
        store.consume({
          key,
          capacity: 5,
          refillPerSecond: 1,
          cost: 1,
          nowMs: START_MS,
        }),
      ).resolves.toMatchObject({ allowed: true, remaining: 3 });
    });
  });
});
