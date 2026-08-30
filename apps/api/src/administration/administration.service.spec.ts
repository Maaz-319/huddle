import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeInviteRepository } from '../../test/fakes/fake-invite-repository';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { AdministrationService } from './administration.service';
import { Role } from './membership-repository.interface';

const OWNER_ID = 300000000000000001n;
const OTHER_USER_ID = 300000000000000002n;

describe('AdministrationService', () => {
  let servers: FakeServerRepository;
  let memberships: FakeMembershipRepository;
  let invites: FakeInviteRepository;
  let service: AdministrationService;

  beforeEach(() => {
    const store = new FakeAdministrationStore();
    servers = new FakeServerRepository(store);
    memberships = new FakeMembershipRepository(store);
    invites = new FakeInviteRepository(store);
    service = new AdministrationService(servers, memberships, invites);
  });

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
});
