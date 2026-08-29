import {
  CreateMembershipInput,
  MembershipRepository,
} from '../../src/administration/membership-repository.interface';
import { ConflictError, NotFoundError } from '../../src/common/errors';

/**
 * Fixed ids the contract's cases key off. The Prisma integration spec seeds
 * real `User`/`Server` rows for exactly these ids before each case, since
 * unlike the fake, real Postgres enforces `Membership`'s foreign keys.
 */
export const SERVER_ID = 400000000000000001n;
export const OTHER_SERVER_ID = 400000000000000002n;
export const USER_ID = 300000000000000001n;
export const OTHER_USER_ID = 300000000000000002n;

const MEMBER: CreateMembershipInput = {
  serverId: SERVER_ID,
  userId: USER_ID,
  role: 'member',
};

/**
 * Builds an empty repository for one test case. The integration suite
 * truncates the database here; the fake suite just constructs a new one.
 */
export type MembershipRepositoryFactory = () => Promise<MembershipRepository>;

/**
 * The behaviour every `MembershipRepository` must have, run against both
 * `FakeMembershipRepository` and `PrismaMembershipRepository`.
 */
export function describeMembershipRepositoryContract(
  label: string,
  createRepository: MembershipRepositoryFactory,
): void {
  describe(`MembershipRepository contract (${label})`, () => {
    let memberships: MembershipRepository;

    beforeEach(async () => {
      memberships = await createRepository();
    });

    describe('create', () => {
      it('seats the user with the given role', async () => {
        const created = await memberships.create(MEMBER);

        expect(created).toMatchObject(MEMBER);
      });

      it('rejects a second membership for the same server and user', async () => {
        await memberships.create(MEMBER);

        await expect(
          memberships.create({ ...MEMBER, role: 'moderator' }),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    });

    describe('findByUserId', () => {
      it('returns every server this user belongs to', async () => {
        await memberships.create(MEMBER);
        await memberships.create({
          serverId: OTHER_SERVER_ID,
          userId: USER_ID,
          role: 'owner',
        });
        await memberships.create({
          serverId: SERVER_ID,
          userId: OTHER_USER_ID,
          role: 'moderator',
        });

        const found = await memberships.findByUserId(USER_ID);

        expect(found.map((m) => m.serverId.toString()).sort()).toEqual(
          [SERVER_ID.toString(), OTHER_SERVER_ID.toString()].sort(),
        );
      });

      it('returns an empty array for a user in no servers', async () => {
        await expect(memberships.findByUserId(USER_ID)).resolves.toEqual([]);
      });
    });

    describe('findByServerAndUser', () => {
      it('finds the membership', async () => {
        const created = await memberships.create(MEMBER);

        await expect(
          memberships.findByServerAndUser(SERVER_ID, USER_ID),
        ).resolves.toEqual(created);
      });

      it('returns null when the user is not a member', async () => {
        await expect(
          memberships.findByServerAndUser(SERVER_ID, USER_ID),
        ).resolves.toBeNull();
      });
    });

    describe('updateRole', () => {
      it('promotes a member to moderator', async () => {
        await memberships.create(MEMBER);

        const updated = await memberships.updateRole(
          SERVER_ID,
          USER_ID,
          'moderator',
        );

        expect(updated).toMatchObject({
          serverId: SERVER_ID,
          userId: USER_ID,
          role: 'moderator',
        });
        await expect(
          memberships.findByServerAndUser(SERVER_ID, USER_ID),
        ).resolves.toMatchObject({ role: 'moderator' });
      });

      it('demotes a moderator back to member', async () => {
        await memberships.create({ ...MEMBER, role: 'moderator' });

        const updated = await memberships.updateRole(
          SERVER_ID,
          USER_ID,
          'member',
        );

        expect(updated).toMatchObject({ role: 'member' });
      });

      it('rejects a user who is not a member of the server', async () => {
        await expect(
          memberships.updateRole(SERVER_ID, USER_ID, 'moderator'),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('transferOwnership', () => {
      it('flips the old owner to member and the target to owner', async () => {
        await memberships.create({ ...MEMBER, role: 'owner' });
        await memberships.create({
          serverId: SERVER_ID,
          userId: OTHER_USER_ID,
          role: 'member',
        });

        await memberships.transferOwnership(SERVER_ID, USER_ID, OTHER_USER_ID);

        await expect(
          memberships.findByServerAndUser(SERVER_ID, USER_ID),
        ).resolves.toMatchObject({ role: 'member' });
        await expect(
          memberships.findByServerAndUser(SERVER_ID, OTHER_USER_ID),
        ).resolves.toMatchObject({ role: 'owner' });
      });

      it('rejects a target who is not a member of the server', async () => {
        await memberships.create({ ...MEMBER, role: 'owner' });

        await expect(
          memberships.transferOwnership(SERVER_ID, USER_ID, OTHER_USER_ID),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });
  });
}
