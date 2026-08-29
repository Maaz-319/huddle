import {
  ProfileSync,
  UserProfile,
  UserRepository,
} from '../../src/auth/user-repository.interface';
import { ConflictError, NotFoundError } from '../../src/common/errors';
import { isSnowflakeString } from '../../src/common/snowflake.service';

const OCTOCAT: UserProfile = {
  githubId: '583231',
  username: 'octocat',
  avatarUrl: 'https://example.test/octocat.png',
  email: 'octocat@example.test',
};

const HUBOT: UserProfile = {
  githubId: '104190',
  username: 'hubot',
  avatarUrl: 'https://example.test/hubot.png',
  email: 'hubot@example.test',
};

/** What GitHub reports after the person renamed themselves and changed avatar. */
const RENAMED: ProfileSync = {
  username: 'monalisa',
  avatarUrl: 'https://example.test/monalisa.png',
  email: 'monalisa@example.test',
};

/**
 * Builds an empty repository for one test case. The integration suite truncates
 * the database here; the fake suite just constructs a new one.
 */
export type RepositoryFactory = () => Promise<UserRepository>;

/**
 * The behaviour every `UserRepository` must have, asserted once and run against
 * both implementations — `FakeUserRepository` in the unit suite, and
 * `PrismaUserRepository` against real Postgres in the integration suite.
 *
 * This shared suite is the point of the paired-testing convention
 * (docs/architecture/repo-structure.md section 6). A fake tested only by its own
 * bespoke assertions proves nothing about the adapter it stands in for; running
 * one suite against both is what makes them actually interchangeable. Copy this
 * file's shape for every later port.
 *
 * Cases that need a real database — BigInt precision, columns the port does not
 * expose — belong in the integration spec, not here.
 */
export function describeUserRepositoryContract(
  label: string,
  createRepository: RepositoryFactory,
): void {
  describe(`UserRepository contract (${label})`, () => {
    let users: UserRepository;

    beforeEach(async () => {
      users = await createRepository();
    });

    describe('create', () => {
      it('returns the profile with a freshly minted Snowflake id', async () => {
        const created = await users.create(OCTOCAT);

        expect(created).toMatchObject({ ...OCTOCAT, bio: null });
        expect(typeof created.id).toBe('bigint');
        expect(isSnowflakeString(created.id.toString())).toBe(true);
      });

      it('gives two users different ids', async () => {
        const first = await users.create(OCTOCAT);
        const second = await users.create(HUBOT);

        expect(first.id).not.toBe(second.id);
      });

      it('rejects a second user for the same GitHub account', async () => {
        await users.create(OCTOCAT);

        await expect(
          users.create({ ...OCTOCAT, username: 'impostor' }),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    });

    describe('findById', () => {
      it('finds a user that was created', async () => {
        const created = await users.create(OCTOCAT);

        await expect(users.findById(created.id)).resolves.toEqual(created);
      });

      it('returns null for an id nobody holds', async () => {
        await users.create(OCTOCAT);

        await expect(users.findById(999000000000000001n)).resolves.toBeNull();
      });
    });

    describe('findByGithubId', () => {
      it('finds the right user when several exist', async () => {
        await users.create(OCTOCAT);
        const hubot = await users.create(HUBOT);

        await expect(users.findByGithubId(HUBOT.githubId)).resolves.toEqual(
          hubot,
        );
      });

      it('returns null for a GitHub account with no user', async () => {
        await users.create(OCTOCAT);

        await expect(users.findByGithubId('404404')).resolves.toBeNull();
      });
    });

    describe('updateProfile', () => {
      it('overwrites the GitHub-owned fields and persists them', async () => {
        const created = await users.create(OCTOCAT);

        const updated = await users.updateProfile(created.id, RENAMED);

        expect(updated).toMatchObject(RENAMED);
        await expect(users.findById(created.id)).resolves.toEqual(updated);
      });

      it('leaves the durable key and the user-set bio alone', async () => {
        const created = await users.create(OCTOCAT);

        const updated = await users.updateProfile(created.id, RENAMED);

        expect(updated.id).toBe(created.id);
        expect(updated.githubId).toBe(OCTOCAT.githubId);
        expect(updated.bio).toBeNull();
      });

      it('does not touch anyone else', async () => {
        const octocat = await users.create(OCTOCAT);
        const hubot = await users.create(HUBOT);

        await users.updateProfile(octocat.id, RENAMED);

        await expect(users.findById(hubot.id)).resolves.toEqual(hubot);
      });

      it('rejects an id nobody holds', async () => {
        await expect(
          users.updateProfile(999000000000000001n, RENAMED),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('updateBio', () => {
      it('sets the bio and persists it', async () => {
        const created = await users.create(OCTOCAT);

        const updated = await users.updateBio(created.id, 'Hello, world.');

        expect(updated.bio).toBe('Hello, world.');
        await expect(users.findById(created.id)).resolves.toEqual(updated);
      });

      it('clears the bio with null', async () => {
        const created = await users.create(OCTOCAT);
        await users.updateBio(created.id, 'Hello, world.');

        const cleared = await users.updateBio(created.id, null);

        expect(cleared.bio).toBeNull();
      });

      it('does not touch anyone else', async () => {
        const octocat = await users.create(OCTOCAT);
        const hubot = await users.create(HUBOT);

        await users.updateBio(octocat.id, 'Hello, world.');

        await expect(users.findById(hubot.id)).resolves.toEqual(hubot);
      });

      it('rejects an id nobody holds', async () => {
        await expect(
          users.updateBio(999000000000000001n, 'Hello, world.'),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('markDeleted', () => {
      it('sets deletedAt and persists it', async () => {
        const created = await users.create(OCTOCAT);
        expect(created.deletedAt).toBeNull();

        await users.markDeleted(created.id);

        const found = await users.findById(created.id);
        expect(found?.deletedAt).toBeInstanceOf(Date);
      });

      it('leaves every other field untouched', async () => {
        const created = await users.create(OCTOCAT);

        await users.markDeleted(created.id);

        const found = await users.findById(created.id);
        expect(found).toMatchObject({ ...OCTOCAT, bio: null });
      });

      it('does not touch anyone else', async () => {
        const octocat = await users.create(OCTOCAT);
        const hubot = await users.create(HUBOT);

        await users.markDeleted(octocat.id);

        await expect(users.findById(hubot.id)).resolves.toEqual(hubot);
      });

      it('rejects an id nobody holds', async () => {
        await expect(
          users.markDeleted(999000000000000001n),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });
  });
}
