import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeChannelMemberRepository } from '../../test/fakes/fake-channel-member-repository';
import { FakeChannelRepository } from '../../test/fakes/fake-channel-repository';
import { FakeInviteRepository } from '../../test/fakes/fake-invite-repository';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/errors';
import { AdministrationService } from './administration.service';
import { Role } from './membership-repository.interface';

const OWNER_ID = 300000000000000001n;
const OTHER_USER_ID = 300000000000000002n;

describe('AdministrationService', () => {
  let servers: FakeServerRepository;
  let memberships: FakeMembershipRepository;
  let invites: FakeInviteRepository;
  let channels: FakeChannelRepository;
  let channelMembers: FakeChannelMemberRepository;
  let service: AdministrationService;

  beforeEach(() => {
    const store = new FakeAdministrationStore();
    servers = new FakeServerRepository(store);
    memberships = new FakeMembershipRepository(store);
    invites = new FakeInviteRepository(store);
    channels = new FakeChannelRepository(store);
    channelMembers = new FakeChannelMemberRepository(store);
    service = new AdministrationService(
      servers,
      memberships,
      invites,
      channels,
      channelMembers,
    );
  });

  /**
   * A server owned by OWNER_ID, with OTHER_USER_ID seated in `role`. The
   * policy is `everyone`, so the channel-creation guard's own question is
   * always answered yes and the tests are about the rules on top of it.
   */
  async function seedServer(role: Role): Promise<bigint> {
    const { server } = await servers.createWithOwner(
      {
        name: 'Huddle HQ',
        iconUrl: null,
        channelCreationPolicy: 'everyone',
        memberInviteToggle: true,
      },
      OWNER_ID,
    );

    if (role !== 'owner') {
      await memberships.create({
        serverId: server.id,
        userId: OTHER_USER_ID,
        role,
      });
    }

    return server.id;
  }

  describe('createServer', () => {
    it('seats the creator as owner and applies the confirmed defaults', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      expect(server.name).toBe('General Chat');
      expect(server.channelCreationPolicy).toBe('everyone');
      expect(server.memberInviteToggle).toBe(true);

      const membership = await memberships.findByServerAndUser(
        server.id,
        OWNER_ID,
      );
      expect(membership).toMatchObject({ role: 'owner' });
    });
  });

  describe('listMyServers', () => {
    it('reflects a server just created', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      const mine = await service.listMyServers(OWNER_ID);

      expect(mine).toEqual([server]);
    });

    it('returns an empty array for a user in no servers', async () => {
      await expect(service.listMyServers(OWNER_ID)).resolves.toEqual([]);
    });
  });

  describe('getServer', () => {
    it('returns the server for a member', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      await expect(service.getServer(server.id, OWNER_ID)).resolves.toEqual(
        server,
      );
    });

    it('rejects a non-member with NotFoundError, not just a permission error', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      await expect(
        service.getServer(server.id, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects an id nobody holds', async () => {
      await expect(
        service.getServer(999000000000000001n, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getInvite', () => {
    /**
     * A server owned by OWNER_ID with the toggle in a given state, plus
     * OTHER_USER_ID seated in `role`. Both halves of the matrix need this, so
     * the toggle and the role are the only things a case varies.
     */
    async function seed(role: Role, memberInviteToggle: boolean) {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });
      await service.updateServer(server.id, { memberInviteToggle });

      if (role !== 'owner') {
        await memberships.create({
          serverId: server.id,
          userId: OTHER_USER_ID,
          role,
        });
      }

      return server;
    }

    it.each([
      ['an owner', 'owner' as const, true],
      ['an owner', 'owner' as const, false],
      ['a moderator', 'moderator' as const, true],
      ['a moderator', 'moderator' as const, false],
      ['a member', 'member' as const, true],
    ])(
      'returns the code for %s with memberInviteToggle %s',
      async (_label, role, toggle) => {
        const server = await seed(role, toggle);
        const callerId = role === 'owner' ? OWNER_ID : OTHER_USER_ID;

        const invite = await service.getInvite(server.id, callerId);

        expect(invite.serverId).toBe(server.id);
        expect(invite.code).toHaveLength(10);
      },
    );

    it('rejects a member when memberInviteToggle is off', async () => {
      const server = await seed('member', false);

      await expect(
        service.getInvite(server.id, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('still serves the owner and moderator on that same server', async () => {
      // The toggle is asserted in both directions rather than only as a
      // rejection: an implementation that gated everyone would pass the case
      // above and fail here.
      const server = await seed('member', false);
      const moderatorId = 300000000000000003n;
      await memberships.create({
        serverId: server.id,
        userId: moderatorId,
        role: 'moderator',
      });

      await expect(
        service.getInvite(server.id, OWNER_ID),
      ).resolves.toMatchObject({ serverId: server.id });
      await expect(
        service.getInvite(server.id, moderatorId),
      ).resolves.toMatchObject({ serverId: server.id });
    });

    it('returns a revoked invite rather than hiding it', async () => {
      const server = await seed('owner', true);
      await invites.revoke(server.id);

      const invite = await service.getInvite(server.id, OWNER_ID);

      // The client has to be told the link is dead in order to say so.
      expect(invite.revokedAt).toBeInstanceOf(Date);
      expect(invite.code).toHaveLength(10);
    });

    it('rejects a caller who is not a member', async () => {
      const server = await seed('owner', true);

      await expect(
        service.getInvite(server.id, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('revokeInvite / regenerateInvite', () => {
    async function seedServer() {
      return service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });
    }

    it('revoking marks the invite dead but keeps the code', async () => {
      const server = await seedServer();
      const before = await service.getInvite(server.id, OWNER_ID);

      const revoked = await service.revokeInvite(server.id);

      expect(revoked.revokedAt).toBeInstanceOf(Date);
      expect(revoked.code).toBe(before.code);
    });

    it('revoking twice leaves the original timestamp alone', async () => {
      const server = await seedServer();
      const first = await service.revokeInvite(server.id);

      const second = await service.revokeInvite(server.id);

      expect(second.revokedAt).toEqual(first.revokedAt);
    });

    it('regenerating swaps the code and keeps the row', async () => {
      const server = await seedServer();
      const before = await service.getInvite(server.id, OWNER_ID);

      const regenerated = await service.regenerateInvite(server.id);

      expect(regenerated.code).not.toBe(before.code);
      expect(regenerated.id).toBe(before.id);
    });

    it('regenerating un-revokes -- there is no separate un-revoke', async () => {
      const server = await seedServer();
      await service.revokeInvite(server.id);

      const regenerated = await service.regenerateInvite(server.id);

      expect(regenerated.revokedAt).toBeNull();
    });

    it('rejects a server with no invite row', async () => {
      // ServerRepository.create seats nobody and mints no invite.
      const bare = await servers.create({
        name: 'Bare',
        iconUrl: null,
        channelCreationPolicy: 'everyone',
        memberInviteToggle: true,
      });

      await expect(service.revokeInvite(bare.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(service.regenerateInvite(bare.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('previewInvite / joinByCode', () => {
    async function seedServer() {
      const server = await service.createServer(OWNER_ID, {
        name: 'Huddle HQ',
        iconUrl: null,
      });
      const invite = await service.getInvite(server.id, OWNER_ID);

      return { server, code: invite.code };
    }

    it('previews the server a code points at', async () => {
      const { server, code } = await seedServer();

      await expect(service.previewInvite(code)).resolves.toMatchObject({
        id: server.id,
        name: 'Huddle HQ',
      });
    });

    it('seats the joiner as a member', async () => {
      const { server, code } = await seedServer();

      await service.joinByCode(code, OTHER_USER_ID);

      await expect(
        memberships.findByServerAndUser(server.id, OTHER_USER_ID),
      ).resolves.toMatchObject({ role: 'member' });
    });

    it('joining twice leaves exactly one membership and never conflicts', async () => {
      const { server, code } = await seedServer();

      await service.joinByCode(code, OTHER_USER_ID);
      // A double-clicked join button is not a failure condition.
      await expect(
        service.joinByCode(code, OTHER_USER_ID),
      ).resolves.toMatchObject({ id: server.id });

      const mine = await memberships.findByUserId(OTHER_USER_ID);
      expect(mine).toHaveLength(1);
    });

    it('does not demote an owner who re-uses their own code', async () => {
      const { server, code } = await seedServer();

      await service.joinByCode(code, OWNER_ID);

      // The idempotent branch must leave the existing role alone, not
      // overwrite it with 'member' -- that would strip the server's owner.
      await expect(
        memberships.findByServerAndUser(server.id, OWNER_ID),
      ).resolves.toMatchObject({ role: 'owner' });
    });

    it('rejects a revoked code and an unknown code identically', async () => {
      const { server, code } = await seedServer();
      await service.revokeInvite(server.id);

      const revoked = await service
        .previewInvite(code)
        .catch((error: NotFoundError) => error);
      const unknown = await service
        .previewInvite('ZZZZZZZZZZ')
        .catch((error: NotFoundError) => error);

      // Same status, same message, no details. A distinguishable response
      // would make the endpoint an oracle for which codes used to be valid.
      expect(revoked).toBeInstanceOf(NotFoundError);
      expect(unknown).toBeInstanceOf(NotFoundError);
      expect((revoked as NotFoundError).message).toBe(
        (unknown as NotFoundError).message,
      );
      expect((revoked as NotFoundError).details).toBeUndefined();
      expect((unknown as NotFoundError).details).toBeUndefined();
    });

    it('refuses to seat anyone through a revoked code', async () => {
      const { server, code } = await seedServer();
      await service.revokeInvite(server.id);

      await expect(
        service.joinByCode(code, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        memberships.findByServerAndUser(server.id, OTHER_USER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('updateServer', () => {
    it('applies a partial update', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      const updated = await service.updateServer(server.id, {
        name: 'Renamed',
      });

      expect(updated.name).toBe('Renamed');
      expect(updated.channelCreationPolicy).toBe('everyone');
    });

    it('rejects an id nobody holds', async () => {
      await expect(
        service.updateServer(999000000000000001n, { name: 'Nope' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('deleteServer', () => {
    it('removes the server', async () => {
      const server = await service.createServer(OWNER_ID, {
        name: 'General Chat',
        iconUrl: null,
      });

      await service.deleteServer(server.id);

      await expect(
        service.updateServer(server.id, { name: 'Anything' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects an id nobody holds', async () => {
      await expect(
        service.deleteServer(999000000000000001n),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listChannels', () => {
    it('returns every public channel to an ordinary member', async () => {
      const serverId = await seedServer('member');
      await channels.create({ serverId, name: 'general', isPrivate: false });
      await channels.create({ serverId, name: 'random', isPrivate: false });

      const listed = await service.listChannels(serverId, OTHER_USER_ID);

      expect(listed.map((channel) => channel.name).sort()).toEqual([
        'general',
        'random',
      ]);
    });

    it('hides a private channel from a member who is not in it', async () => {
      const serverId = await seedServer('member');
      await channels.create({ serverId, name: 'general', isPrivate: false });
      await channels.create({ serverId, name: 'mods', isPrivate: true });

      const listed = await service.listChannels(serverId, OTHER_USER_ID);

      // Fully hidden, not merely unreadable -- administration-service.md
      // section 3. Its existence must not leak through the listing.
      expect(listed.map((channel) => channel.name)).toEqual(['general']);
    });

    it('shows a private channel to a member who is in it', async () => {
      const serverId = await seedServer('member');
      const priv = await channels.create({
        serverId,
        name: 'mods',
        isPrivate: true,
      });
      await channelMembers.add(priv.id, OTHER_USER_ID);

      const listed = await service.listChannels(serverId, OTHER_USER_ID);

      expect(listed.map((channel) => channel.name)).toEqual(['mods']);
    });

    it('hides a private channel from a moderator who is not in it', async () => {
      const serverId = await seedServer('moderator');
      await channels.create({ serverId, name: 'secret', isPrivate: true });

      const listed = await service.listChannels(serverId, OTHER_USER_ID);

      // A moderator is not the owner: the owner bypass is the owner's alone.
      expect(listed).toEqual([]);
    });

    it('shows the owner every private channel without a ChannelMember row', async () => {
      const serverId = await seedServer('owner');
      await channels.create({ serverId, name: 'general', isPrivate: false });
      await channels.create({ serverId, name: 'mods', isPrivate: true });

      const listed = await service.listChannels(serverId, OWNER_ID);

      // Authority is a server-level fact a channel can never touch (PRD
      // section 5) -- a channel cannot hide itself from its server's owner.
      expect(listed.map((channel) => channel.name).sort()).toEqual([
        'general',
        'mods',
      ]);
      await expect(
        channelMembers.findByChannelId(listed[1].id),
      ).resolves.toEqual([]);
    });

    it('makes one bulk membership read, not one per channel', async () => {
      const serverId = await seedServer('member');
      await channels.create({ serverId, name: 'a', isPrivate: true });
      await channels.create({ serverId, name: 'b', isPrivate: true });
      await channels.create({ serverId, name: 'c', isPrivate: true });
      const bulk = jest.spyOn(channelMembers, 'findChannelIdsForUser');
      const single = jest.spyOn(channelMembers, 'isMember');

      await service.listChannels(serverId, OTHER_USER_ID);

      expect(bulk).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
    });

    it('makes no membership read at all when the server has no private channels', async () => {
      const serverId = await seedServer('member');
      await channels.create({ serverId, name: 'general', isPrivate: false });
      const bulk = jest.spyOn(channelMembers, 'findChannelIdsForUser');

      await service.listChannels(serverId, OTHER_USER_ID);

      expect(bulk).not.toHaveBeenCalled();
    });
  });

  describe('createChannel', () => {
    it('creates a channel without seating anyone in it', async () => {
      const { server } = await servers.createWithOwner(
        {
          name: 'Huddle HQ',
          iconUrl: null,
          channelCreationPolicy: 'everyone',
          memberInviteToggle: true,
        },
        OWNER_ID,
      );

      const channel = await service.createChannel(
        { serverId: server.id, name: 'mods', isPrivate: true },
        OWNER_ID,
      );

      // The creator gets no ChannelMember row -- they reach the channel
      // through their server role, and membership is managed by its own
      // routes.
      await expect(channelMembers.findByChannelId(channel.id)).resolves.toEqual(
        [],
      );
    });

    it('refuses a member making a private channel, whatever the policy says', async () => {
      // `everyone` lets this member create channels at all -- that is the
      // guard's question, and it passes. Privacy is the separate question
      // PRD section 5 answers Owner and Moderator only.
      const serverId = await seedServer('member');

      await expect(
        service.createChannel(
          { serverId, name: 'secret', isPrivate: true },
          OTHER_USER_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(channels.findByServerId(serverId)).resolves.toEqual([]);
    });

    it('lets that same member make a public channel', async () => {
      const serverId = await seedServer('member');

      const channel = await service.createChannel(
        { serverId, name: 'general', isPrivate: false },
        OTHER_USER_ID,
      );

      expect(channel.isPrivate).toBe(false);
    });

    it('lets a moderator make a private channel', async () => {
      const serverId = await seedServer('moderator');

      const channel = await service.createChannel(
        { serverId, name: 'mods', isPrivate: true },
        OTHER_USER_ID,
      );

      expect(channel.isPrivate).toBe(true);
    });

    it('makes no membership read at all for a public channel', async () => {
      const serverId = await seedServer('member');
      const read = jest.spyOn(memberships, 'findByServerAndUser');

      await service.createChannel(
        { serverId, name: 'general', isPrivate: false },
        OTHER_USER_ID,
      );

      // The extra read is the price of the privacy rule, so it is only paid
      // when the request actually asks for privacy.
      expect(read).not.toHaveBeenCalled();
    });
  });
  describe('updateChannel', () => {
    it('renames a channel', async () => {
      const serverId = await seedServer('owner');
      const channel = await channels.create({
        serverId,
        name: 'genral',
        isPrivate: false,
      });

      const renamed = await service.updateChannel(channel.id, {
        name: 'general',
      });

      expect(renamed.name).toBe('general');
      await expect(channels.findById(channel.id)).resolves.toMatchObject({
        name: 'general',
      });
    });

    it('refuses a rename onto a name the server already uses', async () => {
      const serverId = await seedServer('owner');
      await channels.create({ serverId, name: 'general', isPrivate: false });
      const other = await channels.create({
        serverId,
        name: 'random',
        isPrivate: false,
      });

      await expect(
        service.updateChannel(other.id, { name: 'general' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('keeps the member list when a private channel is made public', async () => {
      const serverId = await seedServer('member');
      const channel = await channels.create({
        serverId,
        name: 'mods',
        isPrivate: true,
      });
      await channelMembers.add(channel.id, OTHER_USER_ID);

      await service.updateChannel(channel.id, { isPrivate: false });

      // Inert while public, and meaningful again on the way back -- deleting
      // them here would destroy the list on a misclick.
      await expect(
        channelMembers.isMember(channel.id, OTHER_USER_ID),
      ).resolves.toBe(true);
    });

    it('restores the same member list when it is made private again', async () => {
      const serverId = await seedServer('member');
      const channel = await channels.create({
        serverId,
        name: 'mods',
        isPrivate: true,
      });
      await channelMembers.add(channel.id, OTHER_USER_ID);

      await service.updateChannel(channel.id, { isPrivate: false });
      await service.updateChannel(channel.id, { isPrivate: true });

      const listed = await service.listChannels(serverId, OTHER_USER_ID);
      expect(listed.map((c) => c.name)).toEqual(['mods']);
    });

    it('rejects an id nobody holds', async () => {
      await expect(
        service.updateChannel(999000000000000001n, { name: 'general' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('deleteChannel', () => {
    it('removes the channel', async () => {
      const serverId = await seedServer('owner');
      const channel = await channels.create({
        serverId,
        name: 'general',
        isPrivate: false,
      });

      await service.deleteChannel(channel.id);

      await expect(channels.findById(channel.id)).resolves.toBeNull();
    });

    it('rejects an id nobody holds', async () => {
      await expect(
        service.deleteChannel(999000000000000001n),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
  describe('channel members', () => {
    /** A private channel in a server the caller is a plain member of. */
    async function seedPrivateChannel(): Promise<{
      serverId: bigint;
      channelId: bigint;
    }> {
      const serverId = await seedServer('member');
      const channel = await channels.create({
        serverId,
        name: 'mods',
        isPrivate: true,
      });

      return { serverId, channelId: channel.id };
    }

    it('seats a server member', async () => {
      const { channelId } = await seedPrivateChannel();

      const member = await service.addChannelMember(channelId, OTHER_USER_ID);

      expect(member).toMatchObject({ channelId, userId: OTHER_USER_ID });
      await expect(
        channelMembers.isMember(channelId, OTHER_USER_ID),
      ).resolves.toBe(true);
    });

    it('re-adding returns the original row and leaves exactly one', async () => {
      const { channelId } = await seedPrivateChannel();
      const first = await service.addChannelMember(channelId, OTHER_USER_ID);

      const second = await service.addChannelMember(channelId, OTHER_USER_ID);

      // Sliding addedAt forward would quietly rewrite when they joined.
      expect(second.addedAt).toEqual(first.addedAt);
      await expect(service.listChannelMembers(channelId)).resolves.toHaveLength(
        1,
      );
    });

    it("refuses a user who is not in the channel's server", async () => {
      const { channelId } = await seedPrivateChannel();
      const outsider = 300000000000000009n;

      await expect(
        service.addChannelMember(channelId, outsider),
      ).rejects.toBeInstanceOf(ValidationError);

      // Channel membership narrows server membership; it is never a way in.
      await expect(channelMembers.isMember(channelId, outsider)).resolves.toBe(
        false,
      );
    });

    it('refuses an add to a public channel', async () => {
      const serverId = await seedServer('member');
      const channel = await channels.create({
        serverId,
        name: 'general',
        isPrivate: false,
      });

      await expect(
        service.addChannelMember(channel.id, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(channelMembers.findByChannelId(channel.id)).resolves.toEqual(
        [],
      );
    });

    it('lists an empty member list for a public channel rather than throwing', async () => {
      const serverId = await seedServer('member');
      const channel = await channels.create({
        serverId,
        name: 'general',
        isPrivate: false,
      });

      await expect(service.listChannelMembers(channel.id)).resolves.toEqual([]);
    });

    it('removes a seated member', async () => {
      const { channelId } = await seedPrivateChannel();
      await service.addChannelMember(channelId, OTHER_USER_ID);

      await service.removeChannelMember(channelId, OTHER_USER_ID);

      await expect(
        channelMembers.isMember(channelId, OTHER_USER_ID),
      ).resolves.toBe(false);
    });

    it('removing someone who is not there is a no-op, not a throw', async () => {
      const { channelId } = await seedPrivateChannel();

      await expect(
        service.removeChannelMember(channelId, OTHER_USER_ID),
      ).resolves.toBeUndefined();
    });

    it('refuses an add to a channel id nobody holds', async () => {
      await expect(
        service.addChannelMember(999000000000000001n, OTHER_USER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
