import { Membership } from '../../src/administration/membership-repository.interface';
import { Server } from '../../src/administration/server-repository.interface';

/**
 * The `Map`s `FakeServerRepository` and `FakeMembershipRepository` share.
 *
 * In production both real adapters sit on one Postgres database, so a server
 * created via `ServerRepository` is immediately visible to
 * `MembershipRepository.findByUserId`. Two independently-backed fakes would
 * not have that property, so both fakes are constructed against one of these
 * instead of holding their own private `Map` — this is the in-memory stand-in
 * for "one database, two ports."
 */
export class FakeAdministrationStore {
  readonly servers = new Map<bigint, Server>();
  readonly memberships = new Map<string, Membership>();
}

/** The compound key `Membership`'s real `@@id([serverId, userId])` mirrors. */
export function membershipKey(serverId: bigint, userId: bigint): string {
  return `${serverId}:${userId}`;
}
