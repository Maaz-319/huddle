import { isInviteCode } from '../../src/administration/invite-code';
import { InviteRepository } from '../../src/administration/invite-repository.interface';
import {
  CreateServerInput,
  ServerRepository,
} from '../../src/administration/server-repository.interface';
import { NotFoundError } from '../../src/common/errors';

const HUDDLE_HQ: CreateServerInput = {
  name: 'Huddle HQ',
  iconUrl: null,
  channelCreationPolicy: 'everyone',
  memberInviteToggle: true,
};

/**
 * The owner these cases seat. The Prisma integration spec seeds a real `User`
 * row for this id before each case, since unlike the fakes, real Postgres
 * enforces `Membership.userId`'s foreign key.
 */
export const INVITE_OWNER_ID = 310000000000000001n;

/** A server id no row holds — for the "no invite row" cases. */
const NO_SUCH_SERVER = 999000000000000002n;

/**
 * Both ports, because an `Invite` cannot be created on its own: it is minted
 * inside `ServerRepository.createWithOwner`'s transaction, so every case here
 * needs a server to hang one off.
 */
export interface InviteRepositoryFixture {
  invites: InviteRepository;
  servers: ServerRepository;
}

/** Builds an empty pair of repositories for one test case. */
export type InviteRepositoryFactory = () => Promise<InviteRepositoryFixture>;

/**
 * The behaviour every `InviteRepository` must have, run against both
 * `FakeInviteRepository` and `PrismaInviteRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeInviteRepositoryContract(
  label: string,
  createRepositories: InviteRepositoryFactory,
): void {
  describe(`InviteRepository contract (${label})`, () => {
    let invites: InviteRepository;
    let servers: ServerRepository;

    beforeEach(async () => {
      ({ invites, servers } = await createRepositories());
    });

    /** A server with its freshly minted invite. */
    async function seedServer(): Promise<{ serverId: bigint; code: string }> {
      const { server, invite } = await servers.createWithOwner(
        HUDDLE_HQ,
        INVITE_OWNER_ID,
      );

      return { serverId: server.id, code: invite.code };
    }

    describe('findByServerId', () => {
      it('finds the invite minted with the server', async () => {
        const { serverId, code } = await seedServer();

        await expect(invites.findByServerId(serverId)).resolves.toMatchObject({
          serverId,
          code,
          revokedAt: null,
        });
      });

      it('mints a code in the documented format', async () => {
        const { serverId } = await seedServer();

        const invite = await invites.findByServerId(serverId);

        expect(invite).not.toBeNull();
        expect(isInviteCode(invite?.code ?? '')).toBe(true);
      });

      it('returns null for a server that holds no invite', async () => {
        await expect(
          invites.findByServerId(NO_SUCH_SERVER),
        ).resolves.toBeNull();
      });

      it('gives two servers different codes', async () => {
        const first = await seedServer();
        const second = await seedServer();

        expect(first.code).not.toBe(second.code);
      });
    });

    describe('findByCode', () => {
      it('finds the invite by its code', async () => {
        const { serverId, code } = await seedServer();

        await expect(invites.findByCode(code)).resolves.toMatchObject({
          serverId,
          code,
        });
      });

      it('still finds a revoked invite', async () => {
        const { code, serverId } = await seedServer();
        await invites.revoke(serverId);

        // Revocation does not hide the row. The read route has to be able to
        // say "this link is dead", which it cannot do from a null.
        const found = await invites.findByCode(code);

        expect(found?.code).toBe(code);
        expect(found?.revokedAt).toBeInstanceOf(Date);
      });

      it('returns null for a code nobody holds', async () => {
        await seedServer();

        await expect(invites.findByCode('ZZZZZZZZZZ')).resolves.toBeNull();
      });
    });

    describe('regenerate', () => {
      it('replaces the code in the same row', async () => {
        const { serverId, code } = await seedServer();
        const before = await invites.findByServerId(serverId);

        const regenerated = await invites.regenerate(serverId);

        expect(regenerated.code).not.toBe(code);
        expect(isInviteCode(regenerated.code)).toBe(true);
        // "Same slot, new code" -- administration-service.md section 5.
        expect(regenerated.id).toBe(before?.id);
        expect(regenerated.serverId).toBe(serverId);
      });

      it('makes the old code stop resolving', async () => {
        const { serverId, code } = await seedServer();

        await invites.regenerate(serverId);

        await expect(invites.findByCode(code)).resolves.toBeNull();
      });

      it('clears revokedAt, bringing a revoked invite back to life', async () => {
        const { serverId } = await seedServer();
        await invites.revoke(serverId);

        const regenerated = await invites.regenerate(serverId);

        expect(regenerated.revokedAt).toBeNull();
        await expect(invites.findByServerId(serverId)).resolves.toMatchObject({
          revokedAt: null,
        });
      });

      it('rejects a server that holds no invite', async () => {
        await expect(invites.regenerate(NO_SUCH_SERVER)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });

    describe('revoke', () => {
      it('sets revokedAt and leaves the code in place', async () => {
        const { serverId, code } = await seedServer();

        const revoked = await invites.revoke(serverId);

        expect(revoked.revokedAt).toBeInstanceOf(Date);
        expect(revoked.code).toBe(code);
      });

      it('is idempotent -- a second revoke does not move the timestamp', async () => {
        const { serverId } = await seedServer();
        const first = await invites.revoke(serverId);

        const second = await invites.revoke(serverId);

        expect(second.revokedAt).toEqual(first.revokedAt);
      });

      it('rejects a server that holds no invite', async () => {
        await expect(invites.revoke(NO_SUCH_SERVER)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });
  });
}
