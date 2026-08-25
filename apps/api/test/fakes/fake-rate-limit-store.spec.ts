import { FakeRateLimitStore } from './fake-rate-limit-store';
import { describeRateLimitStoreContract } from './rate-limit-store.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no Redis.
 */
describeRateLimitStoreContract('FakeRateLimitStore', () =>
  Promise.resolve(new FakeRateLimitStore()),
);
