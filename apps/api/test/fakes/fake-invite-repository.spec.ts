import { FakeAdministrationStore } from './fake-administration-store';
import { FakeInviteRepository } from './fake-invite-repository';
import { FakeServerRepository } from './fake-server-repository';
import { describeInviteRepositoryContract } from './invite-repository.contract';

describeInviteRepositoryContract('FakeInviteRepository', () => {
  const store = new FakeAdministrationStore();

  return Promise.resolve({
    invites: new FakeInviteRepository(store),
    servers: new FakeServerRepository(store),
  });
});
