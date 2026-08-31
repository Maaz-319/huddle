import { describeChannelOverrideRepositoryContract } from './channel-override-repository.contract';
import { FakeAdministrationStore } from './fake-administration-store';
import { FakeChannelOverrideRepository } from './fake-channel-override-repository';
import { FakeChannelRepository } from './fake-channel-repository';
import { FakeServerRepository } from './fake-server-repository';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeChannelOverrideRepositoryContract(
  'FakeChannelOverrideRepository',
  () => {
    const store = new FakeAdministrationStore();

    return Promise.resolve({
      overrides: new FakeChannelOverrideRepository(store),
      channels: new FakeChannelRepository(store),
      servers: new FakeServerRepository(store),
    });
  },
);
