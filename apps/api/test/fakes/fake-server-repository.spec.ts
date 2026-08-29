import { FakeAdministrationStore } from './fake-administration-store';
import { FakeServerRepository } from './fake-server-repository';
import { describeServerRepositoryContract } from './server-repository.contract';

/**
 * The fake, held to the same contract as the real adapter. Runs in the unit
 * suite: no Docker, no database.
 */
describeServerRepositoryContract('FakeServerRepository', () =>
  Promise.resolve(new FakeServerRepository(new FakeAdministrationStore())),
);
