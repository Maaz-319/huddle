import { ChannelMember } from '../../src/administration/channel-member-repository.interface';
import {
  Capability,
  ChannelOverride,
  OverrideRole,
} from '../../src/administration/channel-override-repository.interface';
import { Channel } from '../../src/administration/channel-repository.interface';
import { Invite } from '../../src/administration/invite-repository.interface';
import { Membership } from '../../src/administration/membership-repository.interface';
import { Server } from '../../src/administration/server-repository.interface';

/**
 * The `Map`s the administration fakes share.
 *
 * In production every real adapter sits on one Postgres database, so a server
 * created via `ServerRepository` is immediately visible to
 * `MembershipRepository.findByUserId`, the invite minted alongside it is
 * immediately visible to `InviteRepository.findByServerId`, and a channel
 * created via `ChannelRepository` is immediately visible to any port that
 * reads one. Independently backed fakes would not have that property, so every
 * fake is constructed against one of these instead of holding its own private
 * `Map` — this is the in-memory stand-in for "one database, many ports."
 */
export class FakeAdministrationStore {
  readonly servers = new Map<bigint, Server>();
  readonly memberships = new Map<string, Membership>();
  /** Keyed by `serverId`, mirroring `Invite.serverId`'s real unique index. */
  readonly invites = new Map<bigint, Invite>();
  readonly channels = new Map<bigint, Channel>();
  readonly channelMembers = new Map<string, ChannelMember>();
  readonly channelOverrides = new Map<string, ChannelOverride>();
}

/** The compound key `Membership`'s real `@@id([serverId, userId])` mirrors. */
export function membershipKey(serverId: bigint, userId: bigint): string {
  return `${serverId}:${userId}`;
}

/** The compound key `ChannelMember`'s real `@@id([channelId, userId])` mirrors. */
export function channelMemberKey(channelId: bigint, userId: bigint): string {
  return `${channelId}:${userId}`;
}

/**
 * The compound key `ChannelOverride`'s real
 * `@@id([channelId, role, capability])` mirrors.
 */
export function channelOverrideKey(
  channelId: bigint,
  role: OverrideRole,
  capability: Capability,
): string {
  return `${channelId}:${role}:${capability}`;
}
