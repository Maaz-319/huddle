import { describeChannelRepositoryContract } from './channel-repository.contract';
import { FakeAdministrationStore } from './fake-administration-store';
import { FakeChannelRepository } from './fake-channel-repository';
import { FakeServerRepository } from './fake-server-repository';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeChannelRepositoryContract('FakeChannelRepository', () => {
  const store = new FakeAdministrationStore();

  return Promise.resolve({
    channels: new FakeChannelRepository(store),
    servers: new FakeServerRepository(store),
  });
});
