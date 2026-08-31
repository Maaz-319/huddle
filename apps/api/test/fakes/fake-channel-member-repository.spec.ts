import { describeChannelMemberRepositoryContract } from './channel-member-repository.contract';
import { FakeAdministrationStore } from './fake-administration-store';
import { FakeChannelMemberRepository } from './fake-channel-member-repository';
import { FakeChannelRepository } from './fake-channel-repository';
import { FakeServerRepository } from './fake-server-repository';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeChannelMemberRepositoryContract('FakeChannelMemberRepository', () => {
  const store = new FakeAdministrationStore();

  return Promise.resolve({
    channelMembers: new FakeChannelMemberRepository(store),
    channels: new FakeChannelRepository(store),
    servers: new FakeServerRepository(store),
  });
});
