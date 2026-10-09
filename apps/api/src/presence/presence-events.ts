/**
 * Presence events emitted by PresenceService when a user's online/offline
 * status changes, and listened to by ChatGateway to broadcast to relevant
 * clients.
 *
 * The event emitter is in-process plumbing for a single-instance app
 * (NFR-10), not an interchangeable backing store, so it is used directly
 * rather than behind a port — same as socket.io and the access events.
 */

/**
 * "This user just came online" — broadcast to everyone who shares at
 * least one server with them.
 */
export const PRESENCE_ONLINE = 'presence_online';

/**
 * "This user just went offline" — broadcast to everyone who shares at
 * least one server with them.
 */
export const PRESENCE_OFFLINE = 'presence_offline';

/** Payload for {@link PRESENCE_ONLINE} and {@link PRESENCE_OFFLINE}. */
export interface PresenceChanged {
  userId: bigint;
}
