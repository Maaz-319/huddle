import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import { NotFoundError } from '../common/errors';
import { AdministrationService } from './administration.service';

const OWNER_ID = 300000000000000001n;
const OTHER_USER_ID = 300000000000000002n;

describe('AdministrationService', () => {
  let servers: FakeServerRepository;
  let memberships: FakeMembershipRepository;
  let service: AdministrationService;

  beforeEach(() => {
    const store = new FakeAdministrationStore();
    servers = new FakeServerRepository(store);
    memberships = new FakeMembershipRepository(store);
    service = new AdministrationService(servers, memberships);
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
});
