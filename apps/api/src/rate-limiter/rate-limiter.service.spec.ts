import { Test } from '@nestjs/testing';
import { FakeRateLimitStore } from '../../test/fakes/fake-rate-limit-store';
import { RateLimitContext } from './rate-limit-key';
import { RATE_LIMIT_POLICIES } from './rate-limit-policies';
import { RateLimitStore } from './rate-limit-store.interface';
import { RateLimiterService } from './rate-limiter.service';

const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.1';
const USER_ID = 8901234567890123n;
const OTHER_USER_ID = 8901234567890124n;
const CHANNEL_ID = 1234567890123456n;
const OTHER_CHANNEL_ID = 1234567890123457n;

/** A fixed clock, so refill is arithmetic rather than a wait. */
const START_MS = 1_700_000_000_000;

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let store: FakeRateLimitStore;
  let now: number;

  beforeEach(async () => {
    now = START_MS;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    store = new FakeRateLimitStore();

    // Against the fake rather than Redis: the port exists so this test needs no
    // Docker, and the adapter is already held to the same contract by its own
    // integration spec (repo-structure.md section 6).
    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: RateLimitStore, useValue: store },
      ],
    }).compile();

    service = moduleRef.get(RateLimiterService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Spends until the bucket refuses, returning how many were allowed. */
  async function drain(
    policy: 'read' | 'message-send' | 'strict-mutation',
    context: RateLimitContext,
  ): Promise<number> {
    let allowed = 0;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const decision = await service.consume(policy, context);
      if (!decision.allowed) return allowed;
      allowed += 1;
    }

    throw new Error('the bucket never refused; it is not capped at all');
  }

  it("spends from the policy's own capacity and refill rate", async () => {
    const spend = jest.spyOn(store, 'consume');

    await service.consume('message-send', { ip: IP, channelId: CHANNEL_ID });

    expect(spend).toHaveBeenCalledWith({
      key: `huddle:rl:message-send:channel:${CHANNEL_ID}`,
      capacity: RATE_LIMIT_POLICIES['message-send'].capacity,
      refillPerSecond: RATE_LIMIT_POLICIES['message-send'].refillPerSecond,
      cost: 1,
      nowMs: START_MS,
    });
  });

  it('reports the policy capacity as the limit', async () => {
    const decision = await service.consume('read', { ip: IP, userId: USER_ID });

    expect(decision.limit).toBe(RATE_LIMIT_POLICIES.read.capacity);
    expect(decision.remaining).toBe(RATE_LIMIT_POLICIES.read.capacity - 1);
  });

  it('reports resetAt as the epoch second the bucket is back to full', async () => {
    const { refillPerSecond } = RATE_LIMIT_POLICIES['strict-mutation'];

    // One token spent out of a full bucket: capacity - remaining is exactly 1.
    const decision = await service.consume('strict-mutation', {
      ip: IP,
      userId: USER_ID,
    });

    const expectedMs = START_MS + (1 / refillPerSecond) * 1000;
    expect(decision.resetAt).toBe(Math.ceil(expectedMs / 1000));
  });

  it('reads the clock on every call, so buckets refill without a wait', async () => {
    const capacity = RATE_LIMIT_POLICIES['strict-mutation'].capacity;
    const context = { ip: IP, userId: USER_ID };

    expect(await drain('strict-mutation', context)).toBe(capacity);

    // One full token back: 3/min, so twenty seconds.
    now += 20_000;

    const decision = await service.consume('strict-mutation', context);
    expect(decision.allowed).toBe(true);
  });

  it('shares one bucket across repeated requests from the same caller', async () => {
    const context = { ip: IP, userId: USER_ID };
    const capacity = RATE_LIMIT_POLICIES.read.capacity;

    expect(await drain('read', context)).toBe(capacity);

    const rejected = await service.consume('read', context);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('gives two callers separate buckets on a per-user policy', async () => {
    await drain('read', { ip: IP, userId: USER_ID });

    // The second caller must arrive at a full bucket, not an exhausted one.
    const decision = await service.consume('read', {
      ip: IP,
      userId: OTHER_USER_ID,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(RATE_LIMIT_POLICIES.read.capacity - 1);
  });

  it('gives two channels separate message-send buckets', async () => {
    // The behaviour section 3 introduces the per-channel dimension for: one
    // user flooding channel A must not spend channel B's budget.
    const context = { ip: IP, userId: USER_ID };

    await drain('message-send', { ...context, channelId: CHANNEL_ID });

    const decision = await service.consume('message-send', {
      ...context,
      channelId: OTHER_CHANNEL_ID,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(
      RATE_LIMIT_POLICIES['message-send'].capacity - 1,
    );
  });

  it('caps a caller with no resolved identity instead of letting them through', async () => {
    // Until Phase 3 a per-user policy keys on the address. The bucket must
    // still be a bucket: an unlimited fallback is the failure this guards.
    const capacity = RATE_LIMIT_POLICIES['strict-mutation'].capacity;

    expect(await drain('strict-mutation', { ip: IP })).toBe(capacity);

    // And it is keyed on the address, so a different one is untouched.
    const other = await service.consume('strict-mutation', { ip: OTHER_IP });
    expect(other.allowed).toBe(true);
  });

  it('spends a heavier cost from a single bucket', async () => {
    const capacity = RATE_LIMIT_POLICIES.read.capacity;

    const decision = await service.consume(
      'read',
      { ip: IP, userId: USER_ID },
      10,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(capacity - 10);
  });
});
