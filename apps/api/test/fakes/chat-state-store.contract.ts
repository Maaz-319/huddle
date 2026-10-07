import {
  ChatStateStore,
  type DeleteResult,
  type EditResult,
  type SendResult,
} from '../../src/chat/chat-state-store.interface';

/**
 * The `key` half of every entry this suite writes starts with this prefix,
 * so the integration run against real Redis can delete exactly what the
 * contract wrote (the adapter composes `huddle:chat:<op>:<user>:<key>`, so
 * the pattern becomes `huddle:chat:*:*:<prefix>*`) and pass twice in a row.
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

/** Fixed results to file; the contract only ever compares them to themselves. */
const SEND_RESULT = {
  messageId: '890123456789012345',
  createdAt: '2026-09-01T12:00:00.000Z',
};

const OTHER_SEND_RESULT = {
  messageId: '890123456789012346',
  createdAt: '2026-09-01T12:00:01.000Z',
};

const EDIT_RESULT = {
  messageId: '890123456789012347',
  editedAt: '2026-09-01T12:00:02.000Z',
};

const OTHER_EDIT_RESULT = {
  messageId: '890123456789012348',
  editedAt: '2026-09-01T12:00:03.000Z',
};

const DELETE_RESULT = { messageId: '890123456789012349' };

const OTHER_DELETE_RESULT = { messageId: '890123456789012350' };

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
 *
 * Since #66 the same six cases run once per operation (send, edit, delete)
 * plus a cross-operation case: all three file results under one retention
 * window, and none of them may answer another's replay.
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

    /** The six behavioural cases, run against one operation's pair of methods. */
    function describeOp<Result>(
      op: 'send' | 'edit' | 'delete',
      remember: (
        store: ChatStateStore,
        user: bigint,
        key: string,
        result: Result,
      ) => Promise<void>,
      recall: (
        store: ChatStateStore,
        user: bigint,
        key: string,
      ) => Promise<Result | null>,
      result: Result,
      other: Result,
    ): void {
      describe(op, () => {
        it('recalls nothing for a key that was never remembered', async () => {
          await expect(
            recall(store, freshUser(), freshKey()),
          ).resolves.toBeNull();
        });

        it('recalls exactly what it remembered', async () => {
          const user = freshUser();
          const key = freshKey();

          await remember(store, user, key, result);

          await expect(recall(store, user, key)).resolves.toEqual(result);
        });

        it('scopes keys per user, so the same nonce cannot collide', async () => {
          const key = freshKey();
          const mine = freshUser();
          const yours = freshUser();

          await remember(store, mine, key, result);
          await remember(store, yours, key, other);

          await expect(recall(store, mine, key)).resolves.toEqual(result);
          await expect(recall(store, yours, key)).resolves.toEqual(other);
        });

        it('keeps separate keys on one user in separate entries', async () => {
          const user = freshUser();
          const first = freshKey();
          const second = freshKey();

          await remember(store, user, first, result);
          await remember(store, user, second, other);

          await expect(recall(store, user, first)).resolves.toEqual(result);
          await expect(recall(store, user, second)).resolves.toEqual(other);
        });

        it('lets a later write under the same key replace the filed result', async () => {
          const user = freshUser();
          const key = freshKey();

          await remember(store, user, key, result);
          await remember(store, user, key, other);

          await expect(recall(store, user, key)).resolves.toEqual(other);
        });

        it('recalls within the retention window and nothing after it', async () => {
          const ttlStore = await createStore(EXPIRY_TTL_MS);
          const user = freshUser();
          const key = freshKey();

          await remember(ttlStore, user, key, result);

          // Halfway through the window it is still there — an implementation
          // that never actually filed the value would also "pass" the expiry
          // half below, so both halves belong to one case.
          await sleep(EXPIRY_TTL_MS / 2);
          await expect(recall(ttlStore, user, key)).resolves.toEqual(result);

          await sleep(EXPIRY_TTL_MS);
          await expect(recall(ttlStore, user, key)).resolves.toBeNull();
        });
      });
    }

    describeOp<SendResult>(
      'send',
      (s, user, key, r) => s.rememberSend(user, key, r),
      (s, user, key) => s.recallSend(user, key),
      SEND_RESULT,
      OTHER_SEND_RESULT,
    );

    describeOp<EditResult>(
      'edit',
      (s, user, key, r) => s.rememberEdit(user, key, r),
      (s, user, key) => s.recallEdit(user, key),
      EDIT_RESULT,
      OTHER_EDIT_RESULT,
    );

    describeOp<DeleteResult>(
      'delete',
      (s, user, key, r) => s.rememberDelete(user, key, r),
      (s, user, key) => s.recallDelete(user, key),
      DELETE_RESULT,
      OTHER_DELETE_RESULT,
    );

    it('keeps one nonce used for two different operations in separate entries', async () => {
      const user = freshUser();
      const key = freshKey();

      await store.rememberSend(user, key, SEND_RESULT);
      await store.rememberEdit(user, key, EDIT_RESULT);
      await store.rememberDelete(user, key, DELETE_RESULT);

      // The three kinds share a window but not a namespace: a client's
      // retry nonce for an edit must never recall the send it happened to
      // use before (or the delete after it).
      await expect(store.recallSend(user, key)).resolves.toEqual(SEND_RESULT);
      await expect(store.recallEdit(user, key)).resolves.toEqual(EDIT_RESULT);
      await expect(store.recallDelete(user, key)).resolves.toEqual(
        DELETE_RESULT,
      );
    });
  });
}
