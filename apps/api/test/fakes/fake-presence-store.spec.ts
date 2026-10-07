import { FakePresenceStore } from './fake-presence-store';
import { describePresenceStoreContract } from './presence-store.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no Redis.
 */
describePresenceStoreContract(
  'FakePresenceStore',
  (heartbeatMs, staleThresholdMs) =>
    Promise.resolve(new FakePresenceStore(heartbeatMs, staleThresholdMs)),
);
