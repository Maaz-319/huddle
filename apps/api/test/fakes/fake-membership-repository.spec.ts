import { FakeAdministrationStore } from './fake-administration-store';
import { FakeMembershipRepository } from './fake-membership-repository';
import { describeMembershipRepositoryContract } from './membership-repository.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeMembershipRepositoryContract('FakeMembershipRepository', () =>
  Promise.resolve(new FakeMembershipRepository(new FakeAdministrationStore())),
);
