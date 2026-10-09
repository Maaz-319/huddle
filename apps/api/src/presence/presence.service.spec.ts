import { EventEmitter2 } from '@nestjs/event-emitter';
import { FakePresenceStore } from '../../test/fakes/fake-presence-store';
import { PresenceService } from './presence.service';
import { PRESENCE_ONLINE, PRESENCE_OFFLINE } from './presence-events';

const USER_ID = 100000000000000001n;
const OTHER_USER_ID = 100000000000000002n;

describe('PresenceService', () => {
  let service: PresenceService;
  let store: FakePresenceStore;
  let events: EventEmitter2;
  let emittedEvents: Array<{ event: string; payload: { userId: bigint } }>;

  beforeEach(() => {
    // Use stale < heartbeat so sweep can find connections before lazy expiry removes them
    const heartbeatMs = 100;
    const staleThresholdMs = 50;
    store = new FakePresenceStore(heartbeatMs, staleThresholdMs);
    events = new EventEmitter2();

    // Capture emitted events
    emittedEvents = [];
    events.on(PRESENCE_ONLINE, (payload: { userId: bigint }) =>
      emittedEvents.push({ event: PRESENCE_ONLINE, payload }),
    );
    events.on(PRESENCE_OFFLINE, (payload: { userId: bigint }) =>
      emittedEvents.push({ event: PRESENCE_OFFLINE, payload }),
    );

    service = new PresenceService(store, events, staleThresholdMs);
  });

  afterEach(() => {
    events.removeAllListeners();
  });

  describe('onConnect', () => {
    it('emits presence_online when user goes from 0 to 1 connection', async () => {
      await service.onConnect(USER_ID, 'socket-1');

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        event: PRESENCE_ONLINE,
        payload: { userId: USER_ID },
      });
    });

    it('does not emit when user already has connections (1 -> 2)', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      emittedEvents.length = 0; // Clear

      await service.onConnect(USER_ID, 'socket-2');

      expect(emittedEvents).toHaveLength(0);
    });

    it('tracks connection count correctly', async () => {
      expect(await store.getConnectionCount(USER_ID)).toBe(0);

      await service.onConnect(USER_ID, 'socket-1');
      expect(await store.getConnectionCount(USER_ID)).toBe(1);

      await service.onConnect(USER_ID, 'socket-2');
      expect(await store.getConnectionCount(USER_ID)).toBe(2);
    });
  });

  describe('onDisconnect', () => {
    it('emits presence_offline when user goes from 1 to 0 connections', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      emittedEvents.length = 0; // Clear

      await service.onDisconnect(USER_ID, 'socket-1');

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        event: PRESENCE_OFFLINE,
        payload: { userId: USER_ID },
      });
    });

    it('does not emit when user still has connections (2 -> 1)', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      await service.onConnect(USER_ID, 'socket-2');
      emittedEvents.length = 0; // Clear

      await service.onDisconnect(USER_ID, 'socket-1');

      expect(emittedEvents).toHaveLength(0);
    });

    it('tracks connection count correctly', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      await service.onConnect(USER_ID, 'socket-2');

      await service.onDisconnect(USER_ID, 'socket-1');
      expect(await store.getConnectionCount(USER_ID)).toBe(1);

      await service.onDisconnect(USER_ID, 'socket-2');
      expect(await store.getConnectionCount(USER_ID)).toBe(0);
    });

    it('does nothing for non-existent connection', async () => {
      await expect(
        service.onDisconnect(USER_ID, 'non-existent'),
      ).resolves.toBeUndefined();
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('onHeartbeat', () => {
    it('updates connection timestamp', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      const conn1 = await store.getConnectionCount(USER_ID);
      expect(conn1).toBe(1);

      // Wait a bit, then heartbeat
      await new Promise((r) => setTimeout(r, 10));
      await service.onHeartbeat(USER_ID, 'socket-1');

      // Connection should still exist (not expired)
      expect(await store.getConnectionCount(USER_ID)).toBe(1);
    });

    it('is no-op for non-existent connection', async () => {
      await expect(
        service.onHeartbeat(USER_ID, 'non-existent'),
      ).resolves.toBeUndefined();
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('sweepStaleConnections', () => {
    it('detects stale connections and emits offline for last connection', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      emittedEvents.length = 0; // Clear online event

      // Wait past stale threshold (50ms) but within heartbeat window (100ms)
      // so lazy expiry doesn't remove it first.
      await new Promise((r) => setTimeout(r, 75));

      await service.sweepStaleConnections();

      // Should have emitted offline
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].event).toBe(PRESENCE_OFFLINE);
      expect(emittedEvents[0].payload.userId).toBe(USER_ID);

      // Connection should be gone
      expect(await store.getConnectionCount(USER_ID)).toBe(0);
    });

    it('does not emit offline if connection was refreshed by heartbeat', async () => {
      await service.onConnect(USER_ID, 'socket-1');

      // Heartbeat before stale threshold
      await new Promise((r) => setTimeout(r, 20));
      await service.onHeartbeat(USER_ID, 'socket-1');

      // Wait past original connection time but not past stale threshold from heartbeat
      // Heartbeat at T+20, stale threshold 50ms, so wait 25ms (total 45ms from start, 25ms from heartbeat)
      await new Promise((r) => setTimeout(r, 25));

      await service.sweepStaleConnections();

      // Should not have emitted offline
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_OFFLINE),
      ).toHaveLength(0);

      // Connection should still exist
      expect(await store.getConnectionCount(USER_ID)).toBe(1);
    });

    it('handles multiple users independently', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      await service.onConnect(OTHER_USER_ID, 'socket-2');
      emittedEvents.length = 0;

      // Wait past stale threshold (50ms) but within heartbeat window (100ms)
      await new Promise((r) => setTimeout(r, 75));

      await service.sweepStaleConnections();

      // Both should go offline
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_OFFLINE),
      ).toHaveLength(2);
      expect(await store.getConnectionCount(USER_ID)).toBe(0);
      expect(await store.getConnectionCount(OTHER_USER_ID)).toBe(0);
    });
  });

  describe('getOnlineUserIds', () => {
    it('returns empty array when no users online', async () => {
      const online = await service.getOnlineUserIds();
      expect(online).toEqual([]);
    });

    it('returns user IDs with active connections', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      await service.onConnect(OTHER_USER_ID, 'socket-2');

      const online = await service.getOnlineUserIds();
      expect(online.sort()).toEqual([USER_ID, OTHER_USER_ID].sort());
    });

    it('excludes users whose connections have expired', async () => {
      await service.onConnect(USER_ID, 'socket-1');
      await service.onConnect(OTHER_USER_ID, 'socket-2');

      // Wait past stale threshold
      await new Promise((r) => setTimeout(r, 150));
      await service.sweepStaleConnections();

      const online = await service.getOnlineUserIds();
      expect(online).toEqual([]);
    });
  });

  describe('multiple connections lifecycle', () => {
    it('connect -> online, second connect -> no re-emit, first disconnect -> no offline, last disconnect -> offline', async () => {
      // First connection
      await service.onConnect(USER_ID, 'socket-1');
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_ONLINE),
      ).toHaveLength(1);
      emittedEvents.length = 0;

      // Second connection
      await service.onConnect(USER_ID, 'socket-2');
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_ONLINE),
      ).toHaveLength(0);
      emittedEvents.length = 0;

      // First disconnect - still has one connection
      await service.onDisconnect(USER_ID, 'socket-1');
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_OFFLINE),
      ).toHaveLength(0);
      emittedEvents.length = 0;

      // Last disconnect - goes offline
      await service.onDisconnect(USER_ID, 'socket-2');
      expect(
        emittedEvents.filter((e) => e.event === PRESENCE_OFFLINE),
      ).toHaveLength(1);
    });
  });
});
