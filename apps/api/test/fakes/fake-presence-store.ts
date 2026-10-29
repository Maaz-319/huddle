import {
  PresenceStore,
  StaleConnection,
  HEARTBEAT_WINDOW_MS,
  STALE_THRESHOLD_MS,
} from '../../src/presence/presence-store.interface';

/**
 * In-memory `PresenceStore`, for unit tests of everything that depends on
 * the port — the presence service, gateway, and broadcast logic — without
 * Docker.
 *
 * `extends PresenceStore` rather than duck-typing it: adding a method to the
 * port then breaks compilation here, which is the only thing keeping a fake
 * honest as the port grows.
 *
 * Data model: `Map<userId, Map<socketId, lastTouchMs>>`.
 *
 * Unlike a timer-based expiry, this uses **lazy expiry on read**: the heartbeat
 * and stale windows are part of the port's contract (the shared suite asserts
 * each), and a fake that remembered forever would make that contract pass while
 * the real adapter expired keys. The clock is `Date.now` at call time — the
 * port's methods take no timestamp, so wall time is the only thing both
 * implementations can be compared on.
 */
export class FakePresenceStore extends PresenceStore {
  private readonly connections = new Map<bigint, Map<string, number>>();

  constructor(
    public heartbeatWindowMs: number = HEARTBEAT_WINDOW_MS,
    public staleThresholdMs: number = STALE_THRESHOLD_MS,
  ) {
    super();
  }

  addConnection(userId: bigint, socketId: string): Promise<void> {
    let userConns = this.connections.get(userId);
    if (!userConns) {
      userConns = new Map();
      this.connections.set(userId, userConns);
    }
    userConns.set(socketId, Date.now());
    return Promise.resolve();
  }

  removeConnection(userId: bigint, socketId: string): Promise<void> {
    const userConns = this.connections.get(userId);
    if (!userConns) return Promise.resolve();

    userConns.delete(socketId);
    if (userConns.size === 0) {
      this.connections.delete(userId);
    }
    return Promise.resolve();
  }

  getConnectionCount(userId: bigint): Promise<number> {
    const userConns = this.connections.get(userId);
    if (!userConns) return Promise.resolve(0);

    // Lazy expiry: drop connections older than heartbeat window
    const now = Date.now();
    let count = 0;
    for (const [socketId, lastTouch] of userConns.entries()) {
      if (now - lastTouch < this.heartbeatWindowMs) {
        count++;
      } else {
        userConns.delete(socketId);
      }
    }
    if (userConns.size === 0) {
      this.connections.delete(userId);
    }
    return Promise.resolve(count);
  }

  getOnlineUserIds(userIds: bigint[]): Promise<bigint[]> {
    const now = Date.now();
    const online: bigint[] = [];

    for (const userId of new Set(userIds)) {
      const userConns = this.connections.get(userId);
      if (userConns === undefined) continue;
      let hasActive = false;
      for (const [socketId, lastTouch] of userConns.entries()) {
        if (now - lastTouch < this.heartbeatWindowMs) {
          hasActive = true;
          break;
        } else {
          userConns.delete(socketId);
        }
      }
      if (!hasActive) {
        this.connections.delete(userId);
      } else {
        online.push(userId);
      }
    }
    return Promise.resolve(online);
  }

  touchConnection(userId: bigint, socketId: string): Promise<void> {
    const userConns = this.connections.get(userId);
    if (!userConns) return Promise.resolve();

    if (userConns.has(socketId)) {
      userConns.set(socketId, Date.now());
    }
    return Promise.resolve();
  }

  getStaleConnections(thresholdMs: number): Promise<StaleConnection[]> {
    const now = Date.now();
    const stale: StaleConnection[] = [];

    for (const [userId, userConns] of this.connections.entries()) {
      for (const [socketId, lastTouch] of userConns.entries()) {
        if (now - lastTouch >= thresholdMs) {
          stale.push({ userId, socketId });
        }
      }
    }
    return Promise.resolve(stale);
  }
}
