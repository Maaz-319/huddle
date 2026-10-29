/**
 * The in-process events Administration emits when what somebody may see
 * changes, and the gateway listens for (issue #69; chat-service.md section 2).
 *
 * `AdministrationService` performs every one of these writes, and
 * `ChatModule` imports `AdministrationModule` — so Administration cannot
 * import Chat back without a circular dependency. The event emitter is the
 * seam: Administration emits, `ChatGateway` listens with `@OnEvent`. Like
 * socket.io itself (repo-structure.md section 4) the bus is in-process
 * plumbing for a single-instance app (NFR-10), not an interchangeable
 * backing store, so it is used directly rather than behind a port.
 *
 * ## The checklist, enumerated — issue #69's warning is that a missed emit
 * is a silent leak
 *
 * 1. User removed from a private channel → `removeChannelMember` →
 *    {@link USER_ACCESS_CHANGED}
 * 2. Channel flipped public → private → `updateChannel` →
 *    {@link SERVER_ACCESS_CHANGED}
 * 3. Channel deleted → `deleteChannel` → {@link SERVER_ACCESS_CHANGED}
 * 4. `view` override added for a role → `revokeCapability` →
 *    {@link SERVER_ACCESS_CHANGED}
 * 5. User demoted (moderator → member) → `updateMemberRole` →
 *    {@link USER_ACCESS_CHANGED} (the same emit covers the promotion half)
 * 6. User removed from the server, or the server deleted:
 *    `deleteServer` → {@link SERVER_ACCESS_CHANGED}. **There is no route
 *    that removes a membership row** — no kick or leave endpoint exists —
 *    so server deletion is currently the only path that removes a user
 *    from a server. When a kick lands it must emit
 *    {@link USER_ACCESS_CHANGED} for the kicked user.
 *
 * The grant direction is the same two events, because the gateway's
 * listener reconciles both ways: `addChannelMember` (seated into a private
 * channel) emits {@link USER_ACCESS_CHANGED}, and `restoreCapability`
 * (revocation removed) emits {@link SERVER_ACCESS_CHANGED}. `transferOwnership`
 * also emits {@link SERVER_ACCESS_CHANGED}: the old owner loses the owner
 * bypass everywhere, which can revoke private channels they were never
 * seated in.
 */

/**
 * "What this one user may see has changed" — reconcile every live
 * connection of `userId` against the accessible set.
 *
 * Emitted by: `removeChannelMember`, `addChannelMember`,
 * `updateMemberRole` (promote or demote).
 */
export const USER_ACCESS_CHANGED = 'user_access_changed';

/**
 * "Something in this server changed that can move many users' access at
 * once" — reconcile the connected set (the gateway deliberately does not
 * guess the affected users from the payload; see the listener).
 *
 * Emitted by: `updateChannel` (visibility flip), `deleteChannel`,
 * `revokeCapability`, `restoreCapability`, `deleteServer`,
 * `transferOwnership`.
 */
export const SERVER_ACCESS_CHANGED = 'server_access_changed';

/**
 * A durable server membership changed after invite join, role change, or
 * ownership transfer. The gateway sends a small invalidation notice to
 * connected server members; clients refetch the authoritative HTTP view.
 */
export const MEMBERSHIP_CHANGED = 'membership_changed';
export interface MembershipChanged {
  serverId: bigint;
}

/**
 * Payload for {@link USER_ACCESS_CHANGED}.
 *
 * `channelId` is present when the write names a channel (a seat change);
 * it is carried for logs and assertions, not as a target — the listener
 * recomputes the user's whole accessible set, because a case like demotion
 * changes channels no write named.
 */
export interface UserAccessChanged {
  userId: bigint;
  channelId?: bigint;
}

/** Payload for {@link SERVER_ACCESS_CHANGED}. Same reasoning as above. */
export interface ServerAccessChanged {
  serverId: bigint;
  channelId?: bigint;
}
