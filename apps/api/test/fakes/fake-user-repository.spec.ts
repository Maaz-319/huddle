import { FakeUserRepository } from './fake-user-repository';
import { describeUserRepositoryContract } from './user-repository.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeUserRepositoryContract('FakeUserRepository', () =>
  Promise.resolve(new FakeUserRepository()),
);
