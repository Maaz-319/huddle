import { RATE_LIMIT_POLICIES, RateLimitDimension } from './rate-limit-policies';

/**
 * The budgets as docs/architecture/rate-limiter.md section 4 records them,
 * written out a second time by hand. A test that read the table it is checking
 * would assert nothing; retuning a budget must mean changing this file too, so
 * the change is visible in review rather than buried in a constant.
 */
const DOCUMENTED = {
  'message-send': { capacity: 5, refillPerSecond: 1, dimension: 'channel' },
  typing: { capacity: 10, refillPerSecond: 2, dimension: 'channel' },
  'auth-ip': { capacity: 5, refillPerSecond: 5 / 60, dimension: 'ip' },
  'strict-mutation': {
    capacity: 3,
    refillPerSecond: 3 / 60,
    dimension: 'user',
  },
  read: { capacity: 60, refillPerSecond: 1, dimension: 'user' },
  'ws-connect': { capacity: 5, refillPerSecond: 5 / 60, dimension: 'ip' },
};

const ALLOWED_DIMENSIONS: RateLimitDimension[] = ['user', 'ip', 'channel'];

describe('RATE_LIMIT_POLICIES', () => {
  it('names every route class in rate-limiter.md section 4, and no others', () => {
    expect(Object.keys(RATE_LIMIT_POLICIES).sort()).toEqual(
      Object.keys(DOCUMENTED).sort(),
    );
  });

  it.each(Object.entries(DOCUMENTED))(
    "gives '%s' its documented capacity, refill rate, and dimension",
    (name, expected) => {
      expect(RATE_LIMIT_POLICIES[name as keyof typeof DOCUMENTED]).toEqual(
        expected,
      );
    },
  );

  it('keys every policy on one of the three dimensions section 3 allows', () => {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(ALLOWED_DIMENSIONS).toContain(policy.dimension);
    }
  });

  it('gives every policy a refill rate above zero', () => {
    // The store has no answer for how long to wait on a bucket that never
    // refills, and would divide by zero working one out.
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(policy.refillPerSecond).toBeGreaterThan(0);
    }
  });
});
