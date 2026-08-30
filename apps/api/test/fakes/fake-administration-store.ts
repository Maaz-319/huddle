import { Invite } from '../../src/administration/invite-repository.interface';
import { Membership } from '../../src/administration/membership-repository.interface';
import { Server } from '../../src/administration/server-repository.interface';

/**
 * The `Map`s `FakeServerRepository`, `FakeMembershipRepository` and
 * `FakeInviteRepository` share.
 *
 * In production all three real adapters sit on one Postgres database, so a
 * server created via `ServerRepository` is immediately visible to
 * `MembershipRepository.findByUserId`, and the invite minted alongside it is
 * immediately visible to `InviteRepository.findByServerId`. Independently
 * backed fakes would not have that property, so every fake is constructed
 * against one of these instead of holding its own private `Map` — this is the
 * in-memory stand-in for "one database, three ports."
 */
export class FakeAdministrationStore {
  readonly servers = new Map<bigint, Server>();
  readonly memberships = new Map<string, Membership>();
  /** Keyed by `serverId`, mirroring `Invite.serverId`'s real unique index. */
  readonly invites = new Map<bigint, Invite>();
}

/** The compound key `Membership`'s real `@@id([serverId, userId])` mirrors. */
export function membershipKey(serverId: bigint, userId: bigint): string {
  return `${serverId}:${userId}`;
}
