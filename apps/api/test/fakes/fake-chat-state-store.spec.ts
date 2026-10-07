import { FakeChatStateStore } from './fake-chat-state-store';
import { describeChatStateStoreContract } from './chat-state-store.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no Redis.
 */
describeChatStateStoreContract(
  'FakeChatStateStore',
  (ttlMs, debounceMs, violationWindowMs) =>
    Promise.resolve(
      new FakeChatStateStore(ttlMs, debounceMs, violationWindowMs),
    ),
);
