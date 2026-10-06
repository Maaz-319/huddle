import { ChatStateStore } from '../../src/chat/chat-state-store.interface';

/**
 * The `key` half of every entry this suite writes starts with this prefix,
 * so the integration run against real Redis can delete exactly what the
 * contract wrote (the adapter composes `huddle:chat:send:<user>:<key>`, so
 * the pattern becomes `huddle:chat:send:*:<prefix>*`) and pass twice in a
 * row.
 */
export const CHAT_STATE_CONTRACT_KEY_PREFIX =
  'huddle:test:chat-state-contract:';

/**
 * The retention window used by every case that is not asserting expiry — the
 * port's documented default (chat-service.md section 4).
 */
const DEFAULT_TTL_MS = 30_000;

/** Short enough to sleep through, long enough that it never flakes early. */
const EXPIRY_TTL_MS = 250;

/**
 * Builds a store for one case. The fake constructs a new one; the integration
 * suite hands back a fresh adapter over the same Redis, so the `ttlMs` a case
 * asks for actually applies (expiry is per-SET, decided at write time).
 */
export type ChatStateStoreFactory = (ttlMs: number) => Promise<ChatStateStore>;

/** A fixed result to file; the contract only ever compares it to itself. */
const RESULT = {
  messageId: '890123456789012345',
  createdAt: '2026-09-01T12:00:00.000Z',
};

const OTHER_RESULT = {
  messageId: '890123456789012346',
  createdAt: '2026-09-01T12:00:01.000Z',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The behaviour every `ChatStateStore` must have, asserted once and run
 * against both implementations — `FakeChatStateStore` in the unit suite, and
 * `RedisChatStateStore` against real Redis in the integration suite.
 *
 * This shared suite is the point of the paired-testing convention
 * (docs/architecture/repo-structure.md section 6): a fake tested only by its
 * own bespoke assertions proves nothing about the adapter it stands in for.
 */
export function describeChatStateStoreContract(
  label: string,
  createStore: ChatStateStoreFactory,
): void {
  describe(`ChatStateStore contract (${label})`, () => {
    let store: ChatStateStore;
    let caseCounter = 0;

    /**
     * User ids and keys nothing else in the run has used. Real Redis, unlike
     * a fresh `Map`, carries state between cases, so isolation comes from the
     * pair — which is also exactly what the per-user scoping claim is about.
     */
    let nextUser = 9_900_000n;
    const freshUser = (): bigint => (nextUser += 1n);
    const freshKey = (): string =>
      `${CHAT_STATE_CONTRACT_KEY_PREFIX}${label}:${caseCounter++}:${Date.now()}`;

    beforeEach(async () => {
      store = await createStore(DEFAULT_TTL_MS);
    });

    it('recalls nothing for a key that was never remembered', async () => {
      await expect(
        store.recallSend(freshUser(), freshKey()),
      ).resolves.toBeNull();
    });

    it('recalls exactly what it remembered', async () => {
      const user = freshUser();
      const key = freshKey();

      await store.rememberSend(user, key, RESULT);

      await expect(store.recallSend(user, key)).resolves.toEqual(RESULT);
    });

    it('scopes keys per user, so the same nonce cannot collide', async () => {
      const key = freshKey();
      const mine = freshUser();
      const yours = freshUser();

      await store.rememberSend(mine, key, RESULT);
      await store.rememberSend(yours, key, OTHER_RESULT);

      await expect(store.recallSend(mine, key)).resolves.toEqual(RESULT);
      await expect(store.recallSend(yours, key)).resolves.toEqual(OTHER_RESULT);
    });

    it('keeps separate keys on one user in separate entries', async () => {
      const user = freshUser();
      const first = freshKey();
      const second = freshKey();

      await store.rememberSend(user, first, RESULT);
      await store.rememberSend(user, second, OTHER_RESULT);

      await expect(store.recallSend(user, first)).resolves.toEqual(RESULT);
      await expect(store.recallSend(user, second)).resolves.toEqual(
        OTHER_RESULT,
      );
    });

    it('lets a later write under the same key replace the filed result', async () => {
      const user = freshUser();
      const key = freshKey();

      await store.rememberSend(user, key, RESULT);
      await store.rememberSend(user, key, OTHER_RESULT);

      await expect(store.recallSend(user, key)).resolves.toEqual(OTHER_RESULT);
    });

    it('recalls within the retention window and nothing after it', async () => {
      const ttlStore = await createStore(EXPIRY_TTL_MS);
      const user = freshUser();
      const key = freshKey();

      await ttlStore.rememberSend(user, key, RESULT);

      // Halfway through the window it is still there — an implementation that
      // never actually filed the value would also "pass" the expiry half
      // below, so both halves belong to one case.
      await sleep(EXPIRY_TTL_MS / 2);
      await expect(ttlStore.recallSend(user, key)).resolves.toEqual(RESULT);

      await sleep(EXPIRY_TTL_MS);
      await expect(ttlStore.recallSend(user, key)).resolves.toBeNull();
    });
  });
}
