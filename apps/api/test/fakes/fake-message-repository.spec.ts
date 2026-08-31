import { FakeAdministrationStore } from './fake-administration-store';
import { FakeChannelRepository } from './fake-channel-repository';
import { FakeMessageRepository } from './fake-message-repository';
import { FakeServerRepository } from './fake-server-repository';
import { describeMessageRepositoryContract } from './message-repository.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeMessageRepositoryContract('FakeMessageRepository', () => {
  const store = new FakeAdministrationStore();

  return Promise.resolve({
    messages: new FakeMessageRepository(store),
    channels: new FakeChannelRepository(store),
    servers: new FakeServerRepository(store),
  });
});
