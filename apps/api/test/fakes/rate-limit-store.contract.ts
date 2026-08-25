import { RateLimitStore } from '../../src/rate-limiter/rate-limit-store.interface';

/**
 * Every key this suite touches lives under one prefix, so the integration run
 * against real Redis can delete exactly what it wrote and pass twice in a row.
 */
export const CONTRACT_KEY_PREFIX = 'huddle:test:rate-limit-contract:';

/** A bucket small enough to exhaust in a line and refill in a second. */
const CAPACITY = 5;
const REFILL_PER_SECOND = 1;

/** An arbitrary fixed epoch. Time only ever moves by arithmetic from here. */
const START_MS = 1_700_000_000_000;

/**
 * Builds an empty store for one case. The fake constructs a new one; the
 * integration suite hands back the adapter, whose isolation comes from every
 * case using a fresh key.
 */
export type StoreFactory = () => Promise<RateLimitStore>;

/**
 * The behaviour every `RateLimitStore` must have, asserted once and run against
 * both implementations — `FakeRateLimitStore` in the unit suite, and
 * `RedisRateLimitStore` against real Redis in the integration suite.
 *
 * This shared suite is the point of the paired-testing convention
 * (docs/architecture/repo-structure.md section 6). A fake tested only by its own
 * bespoke assertions proves nothing about the adapter it stands in for.
 *
 * Cases that need real Redis — atomicity under genuine concurrency, key
 * expiry — belong in the integration spec, not here.
 */
export function describeRateLimitStoreContract(
  label: string,
  createStore: StoreFactory,
): void {
  describe(`RateLimitStore contract (${label})`, () => {
    let store: RateLimitStore;
    let keyCounter = 0;

    /**
     * A key nothing else in the run has used. Real Redis, unlike a fresh `Map`,
     * carries state between cases, so isolation has to come from the key.
     */
    const freshKey = (): string =>
      `${CONTRACT_KEY_PREFIX}${label}:${keyCounter++}:${Date.now()}`;

    const consume = (
      key: string,
      nowMs: number,
      cost = 1,
    ): ReturnType<RateLimitStore['consume']> =>
      store.consume({
        key,
        capacity: CAPACITY,
        refillPerSecond: REFILL_PER_SECOND,
        cost,
        nowMs,
      });

    beforeEach(async () => {
      store = await createStore();
    });

    it('lets a fresh key spend a full burst, all at the same instant', async () => {
      const key = freshKey();

      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await expect(consume(key, START_MS)).resolves.toMatchObject({
          allowed: true,
          retryAfterMs: 0,
        });
      }
    });

    it('rejects the request past capacity', async () => {
      const key = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(key, START_MS);
      }

      await expect(consume(key, START_MS)).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });

    it('counts remaining down as tokens are spent', async () => {
      const key = freshKey();

      for (let spent = 1; spent <= CAPACITY; spent++) {
        const result = await consume(key, START_MS);

        expect(result.remaining).toBe(CAPACITY - spent);
      }
    });

    it('tells a rejected caller to wait about one token of refill', async () => {
      const key = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(key, START_MS);
      }

      const rejected = await consume(key, START_MS);

      // One token at one per second: a full second away, and never zero, which
      // would tell the client to retry immediately.
      expect(rejected.retryAfterMs).toBeGreaterThan(0);
      expect(rejected.retryAfterMs).toBe(1000 / REFILL_PER_SECOND);
    });

    it('refills as time advances', async () => {
      const key = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(key, START_MS);
      }
      await expect(consume(key, START_MS)).resolves.toMatchObject({
        allowed: false,
      });

      // One second later exactly one token is back: it buys one request, and
      // the next is rejected again.
      await expect(consume(key, START_MS + 1000)).resolves.toMatchObject({
        allowed: true,
      });
      await expect(consume(key, START_MS + 1000)).resolves.toMatchObject({
        allowed: false,
      });
    });

    it('never refills past capacity, however long it sits idle', async () => {
      const key = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(key, START_MS);
      }

      const anHourLater = START_MS + 3_600_000;

      // An hour of refill at one per second is 3600 tokens, but the bucket
      // holds five. Without the ceiling, an idle caller would bank an
      // unlimited burst -- which is the whole thing a token bucket must not do.
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await expect(consume(key, anHourLater)).resolves.toMatchObject({
          allowed: true,
        });
      }

      await expect(consume(key, anHourLater)).resolves.toMatchObject({
        allowed: false,
      });
    });

    it('keeps separate keys in separate buckets', async () => {
      const mine = freshKey();
      const yours = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(mine, START_MS);
      }
      await expect(consume(mine, START_MS)).resolves.toMatchObject({
        allowed: false,
      });

      await expect(consume(yours, START_MS)).resolves.toMatchObject({
        allowed: true,
        remaining: CAPACITY - 1,
      });
    });

    it('spends the whole cost of a request worth more than one token', async () => {
      const key = freshKey();

      await expect(consume(key, START_MS, 3)).resolves.toMatchObject({
        allowed: true,
        remaining: CAPACITY - 3,
      });

      // Two left, three wanted.
      await expect(consume(key, START_MS, 3)).resolves.toMatchObject({
        allowed: false,
        remaining: CAPACITY - 3,
      });
    });

    it('does not spend anything on a rejected request', async () => {
      const key = freshKey();
      for (let attempt = 0; attempt < CAPACITY; attempt++) {
        await consume(key, START_MS);
      }

      // Being over budget must not dig the bucket deeper: a caller hammering a
      // closed door would otherwise push their own recovery further away with
      // every attempt.
      await consume(key, START_MS);
      await consume(key, START_MS);

      await expect(consume(key, START_MS + 1000)).resolves.toMatchObject({
        allowed: true,
      });
    });
  });
}
