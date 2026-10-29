/**
 * The heartbeat window for socket.io ping/pong:
 * pingInterval: 10s + pingTimeout: 20s ≈ 30s worst-case detection.
 * Matches docs/architecture/presence-module.md section 3.
 */
export const HEARTBEAT_WINDOW_MS = 30_000;

/**
 * Threshold for considering a connection "stale" (dirty disconnect).
 * 5s buffer above the heartbeat window to avoid false positives
 * from normal timer jitter.
 */
export const STALE_THRESHOLD_MS = 35_000;

/**
 * One connection entry returned by {@link PresenceStore.getStaleConnections}.
 */
export interface StaleConnection {
  userId: bigint;
  socketId: string;
}

/**
 * Presence connection registry port.
 *
 * Tracks active WebSocket connections per user, heartbeats, and computes
 * online/offline state. A user is online iff they have ≥1 active connection.
 *
 * Everything this stores is **intentionally ephemeral** (AGENTS.md section 8):
 * a lost key means one user appears offline until their next reconnect —
 * never a correctness bug. Nothing here gates correctness on surviving a restart.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and a TS interface is erased at compile time — see
 * docs/architecture/repo-structure.md section 3.
 */
export abstract class PresenceStore {
  /**
   * Register a new active connection for a user.
   *
   * Called when a socket.io connection authenticates and joins.
   * Idempotent: if the same socketId is added again, it refreshes the
   * connection's last-touch timestamp.
   */
  abstract addConnection(userId: bigint, socketId: string): Promise<void>;

  /**
   * Deregister a connection (clean disconnect).
   *
   * Called on graceful socket close. If this was the user's last
   * connection, the user flips offline immediately.
   */
  abstract removeConnection(userId: bigint, socketId: string): Promise<void>;

  /**
   * Number of currently active connections for a user.
   *
   * Returns 0 if the user has no connections or all have expired.
   */
  abstract getConnectionCount(userId: bigint): Promise<number>;

  /**
   * The requested users who have ≥1 active connection, for an initial
   * presence snapshot. Implementations must not scan unrelated users.
   */
  abstract getOnlineUserIds(userIds: bigint[]): Promise<bigint[]>;

  /**
   * Heartbeat touch — called on each socket.io pong.
   *
   * Updates the connection's last-touch timestamp. If the connection
   * doesn't exist (e.g., race with clean disconnect), this is a no-op.
   *
   * Implementations may shorten the window via their constructor so
   * tests need not sleep the default `HEARTBEAT_WINDOW_MS`.
   */
  abstract touchConnection(userId: bigint, socketId: string): Promise<void>;

  /**
   * Connections that haven't been touched within the threshold.
   *
   * Used by a background sweep to detect dirty disconnects (network drop,
   * crash, no graceful close frame). The threshold is typically
   * `STALE_THRESHOLD_MS` but callers may pass a different value.
   *
   * Returns the userId and socketId pairs so the caller can clean them up
   * and trigger offline transitions where appropriate.
   */
  abstract getStaleConnections(thresholdMs: number): Promise<StaleConnection[]>;
}
