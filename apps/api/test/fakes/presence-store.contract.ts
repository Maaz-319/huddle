import { PresenceStore } from '../../src/presence/presence-store.interface';

/**
 * The user id floor for contract tests. Real Snowflake ids have top bits
 * encoding a 2020s epoch timestamp (landing in the `2*` range for millennia).
 * `9_900_000n` upward gives a `99*` prefix that real ids never match, so
 * cleanup globs like `huddle:presence:connections:99*` are safe.
 */
export const PRESENCE_CONTRACT_USER_FLOOR = 9_900_000n;

/**
 * Heartbeat window used by every case that is not asserting expiry — the
 * port's documented default (presence-module.md section 3).
 */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/** Short enough to sleep through, long enough that it never flakes early. */
export const EXPIRY_HEARTBEAT_MS = 250;

/**
 * Stale threshold used by the "does later touch extend it?" case — two
 * seconds, so that case can sleep against its edges with hundreds of
 * milliseconds of margin instead of racing a few hundred milliseconds of
 * timer jitter. The plain expiry case reuses `EXPIRY_HEARTBEAT_MS` above.
 */
export const STALE_TEST_THRESHOLD_MS = 2_000;

/**
 * Builds a store for one case. The fake constructs a new one; the integration
 * suite hands back a fresh adapter over the same Redis, so the `heartbeatMs`
 * a case asks for actually applies (expiry is per-key, decided at write time).
 * The optional `staleThresholdMs` shrinks the stale window the same way.
 */
export type PresenceStoreFactory = (
  heartbeatMs: number,
  staleThresholdMs?: number,
) => Promise<PresenceStore>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The behaviour every `PresenceStore` must have, asserted once and run
 * against both implementations — `FakePresenceStore` in the unit suite, and
 * `RedisPresenceStore` against real Redis in the integration suite.
 *
 * This shared suite is the point of the paired-testing convention
 * (docs/architecture/repo-structure.md section 6): a fake tested only by its
 * own bespoke assertions proves nothing about the adapter it stands in for.
 */
export function describePresenceStoreContract(
  label: string,
  createStore: PresenceStoreFactory,
): void {
  describe(`PresenceStore contract (${label})`, () => {
    let store: PresenceStore;
    let caseCounter = 0;

    let nextUser = PRESENCE_CONTRACT_USER_FLOOR;
    const freshUser = (): bigint => (nextUser += 1n);

    const freshSocket = (): string =>
      `socket-${label}:${caseCounter++}:${Date.now()}`;

    beforeEach(async () => {
      store = await createStore(DEFAULT_HEARTBEAT_MS);
    });

    describe('addConnection / removeConnection / getConnectionCount', () => {
      it('returns 0 for a user with no connections', async () => {
        await expect(store.getConnectionCount(freshUser())).resolves.toBe(0);
      });

      it('adds one connection and counts it', async () => {
        const user = freshUser();
        const socket = freshSocket();

        await store.addConnection(user, socket);

        await expect(store.getConnectionCount(user)).resolves.toBe(1);
      });

      it('removes a connection and decrements the count', async () => {
        const user = freshUser();
        const socket = freshSocket();

        await store.addConnection(user, socket);
        await expect(store.getConnectionCount(user)).resolves.toBe(1);

        await store.removeConnection(user, socket);
        await expect(store.getConnectionCount(user)).resolves.toBe(0);
      });

      it('tracks multiple connections per user independently', async () => {
        const user = freshUser();
        const socketA = freshSocket();
        const socketB = freshSocket();

        await store.addConnection(user, socketA);
        await store.addConnection(user, socketB);
        await expect(store.getConnectionCount(user)).resolves.toBe(2);

        await store.removeConnection(user, socketA);
        await expect(store.getConnectionCount(user)).resolves.toBe(1);

        await store.removeConnection(user, socketB);
        await expect(store.getConnectionCount(user)).resolves.toBe(0);
      });

      it('is idempotent: adding the same socket twice refreshes the timestamp', async () => {
        const heartbeatStore = await createStore(EXPIRY_HEARTBEAT_MS);
        const user = freshUser();
        const socket = freshSocket();

        await heartbeatStore.addConnection(user, socket);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(1);

        // Wait past half the window, re-add same socket (simulates re-auth)
        await sleep(EXPIRY_HEARTBEAT_MS / 2);
        await heartbeatStore.addConnection(user, socket);

        // Should still be there (timestamp refreshed)
        await sleep(EXPIRY_HEARTBEAT_MS / 2);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(1);

        // But gone after full window from the *second* add
        await sleep(EXPIRY_HEARTBEAT_MS);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(0);
      });

      it('scopes connections per user: two users with same socketId do not collide', async () => {
        const userA = freshUser();
        const userB = freshUser();
        const socket = freshSocket();

        await store.addConnection(userA, socket);
        await store.addConnection(userB, socket);

        await expect(store.getConnectionCount(userA)).resolves.toBe(1);
        await expect(store.getConnectionCount(userB)).resolves.toBe(1);

        await store.removeConnection(userA, socket);
        await expect(store.getConnectionCount(userA)).resolves.toBe(0);
        await expect(store.getConnectionCount(userB)).resolves.toBe(1);
      });
    });

    describe('getOnlineUserIds', () => {
      it('returns empty array when no users are online', async () => {
        await expect(store.getOnlineUserIds([])).resolves.toEqual([]);
      });

      it('returns only users with ≥1 active connection', async () => {
        const userA = freshUser();
        const userB = freshUser();
        const userC = freshUser(); // never connected

        await store.addConnection(userA, freshSocket());
        await store.addConnection(userB, freshSocket());
        await store.addConnection(userB, freshSocket()); // userB has 2

        await expect(
          store.getOnlineUserIds([userA, userB, userC]),
        ).resolves.toEqual(expect.arrayContaining([userA, userB]));
        await expect(store.getOnlineUserIds([userC])).resolves.not.toContain(
          userC,
        );
      });

      it('checks only the requested users', async () => {
        const online = freshUser();
        const unrequested = freshUser();
        await store.addConnection(online, freshSocket());
        await store.addConnection(unrequested, freshSocket());

        await expect(store.getOnlineUserIds([online])).resolves.toEqual([
          online,
        ]);
      });

      it('excludes users whose connections have all expired', async () => {
        const shortStore = await createStore(EXPIRY_HEARTBEAT_MS);
        const user = freshUser();

        await shortStore.addConnection(user, freshSocket());
        await expect(shortStore.getOnlineUserIds([user])).resolves.toContain(
          user,
        );

        await sleep(EXPIRY_HEARTBEAT_MS * 2);
        await expect(
          shortStore.getOnlineUserIds([user]),
        ).resolves.not.toContain(user);
      });
    });

    describe('touchConnection', () => {
      it('updates the last-touch timestamp for an existing connection', async () => {
        const heartbeatStore = await createStore(EXPIRY_HEARTBEAT_MS);
        const user = freshUser();
        const socket = freshSocket();

        await heartbeatStore.addConnection(user, socket);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(1);

        // Halfway to expiry, touch it
        await sleep(EXPIRY_HEARTBEAT_MS / 2);
        await heartbeatStore.touchConnection(user, socket);

        // Another half window — should still be alive (total > window from first add)
        await sleep(EXPIRY_HEARTBEAT_MS / 2);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(1);

        // Full window from the *touch* — should be gone
        await sleep(EXPIRY_HEARTBEAT_MS);
        await expect(heartbeatStore.getConnectionCount(user)).resolves.toBe(0);
      });

      it('is a no-op for a non-existent connection', async () => {
        const user = freshUser();
        const socket = freshSocket();

        // Should not throw, just return
        await expect(
          store.touchConnection(user, socket),
        ).resolves.toBeUndefined();
        await expect(store.getConnectionCount(user)).resolves.toBe(0);
      });

      it('does not create a connection if the user has none', async () => {
        const user = freshUser();
        const socket = freshSocket();

        await store.touchConnection(user, socket);
        await expect(store.getConnectionCount(user)).resolves.toBe(0);
      });
    });

    describe('getStaleConnections', () => {
      it('returns empty when no connections are stale', async () => {
        const user = freshUser();
        await store.addConnection(user, freshSocket());

        await expect(
          store.getStaleConnections(STALE_TEST_THRESHOLD_MS),
        ).resolves.toEqual([]);
      });

      it('finds connections older than the threshold', async () => {
        const staleStore = await createStore(
          DEFAULT_HEARTBEAT_MS,
          STALE_TEST_THRESHOLD_MS,
        );
        const user = freshUser();
        const socket = freshSocket();

        await staleStore.addConnection(user, socket);

        // Wait past the stale threshold
        await sleep(STALE_TEST_THRESHOLD_MS + 50);

        await expect(
          staleStore.getStaleConnections(STALE_TEST_THRESHOLD_MS),
        ).resolves.toEqual([{ userId: user, socketId: socket }]);
      });

      it('scopes staleness per connection: one stale, one fresh on same user', async () => {
        const staleStore = await createStore(
          DEFAULT_HEARTBEAT_MS,
          STALE_TEST_THRESHOLD_MS,
        );
        const user = freshUser();
        const staleSocket = freshSocket();
        const freshSocketId = freshSocket();

        await staleStore.addConnection(user, staleSocket);
        await sleep(STALE_TEST_THRESHOLD_MS + 50);
        await staleStore.addConnection(user, freshSocketId); // fresh connection

        const stale = await staleStore.getStaleConnections(
          STALE_TEST_THRESHOLD_MS,
        );
        expect(stale).toHaveLength(1);
        expect(stale[0]).toEqual({ userId: user, socketId: staleSocket });
      });

      it('returns connections from multiple users', async () => {
        const staleStore = await createStore(
          DEFAULT_HEARTBEAT_MS,
          STALE_TEST_THRESHOLD_MS,
        );
        const userA = freshUser();
        const userB = freshUser();
        const socketA = freshSocket();
        const socketB = freshSocket();

        await staleStore.addConnection(userA, socketA);
        await staleStore.addConnection(userB, socketB);
        await sleep(STALE_TEST_THRESHOLD_MS + 50);

        const stale = await staleStore.getStaleConnections(
          STALE_TEST_THRESHOLD_MS,
        );
        expect(stale).toHaveLength(2);
        expect(stale).toEqual(
          expect.arrayContaining([
            { userId: userA, socketId: socketA },
            { userId: userB, socketId: socketB },
          ]),
        );
      });
    });

    describe('clean vs dirty disconnect', () => {
      it('clean disconnect (removeConnection) removes immediately', async () => {
        const user = freshUser();
        const socket = freshSocket();

        await store.addConnection(user, socket);
        await expect(store.getConnectionCount(user)).resolves.toBe(1);

        await store.removeConnection(user, socket);
        await expect(store.getConnectionCount(user)).resolves.toBe(0);
        await expect(store.getOnlineUserIds([user])).resolves.not.toContain(
          user,
        );
      });

      it('dirty disconnect (no removeConnection) detected via getStaleConnections', async () => {
        const staleStore = await createStore(
          DEFAULT_HEARTBEAT_MS,
          STALE_TEST_THRESHOLD_MS,
        );
        const user = freshUser();
        const socket = freshSocket();

        await staleStore.addConnection(user, socket);
        await expect(staleStore.getConnectionCount(user)).resolves.toBe(1);

        // Simulate dirty disconnect: no removeConnection, just wait
        await sleep(STALE_TEST_THRESHOLD_MS + 50);

        const stale = await staleStore.getStaleConnections(
          STALE_TEST_THRESHOLD_MS,
        );
        expect(stale).toHaveLength(1);
        expect(stale[0]).toEqual({ userId: user, socketId: socket });

        // After cleaning up stale, user should be offline
        await staleStore.removeConnection(user, socket);
        await expect(staleStore.getConnectionCount(user)).resolves.toBe(0);
        await expect(
          staleStore.getOnlineUserIds([user]),
        ).resolves.not.toContain(user);
      });
    });
  });
}
