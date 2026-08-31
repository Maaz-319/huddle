import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990100,
  login: 'octocat-access-e2e-owner',
  email: 'octocat-access-e2e-owner@example.com',
};

const MODERATOR = {
  githubId: 990101,
  login: 'octocat-access-e2e-moderator',
  email: 'octocat-access-e2e-moderator@example.com',
};

const MEMBER = {
  githubId: 990102,
  login: 'octocat-access-e2e-member',
  email: 'octocat-access-e2e-member@example.com',
};

const FIXTURES = [OWNER, MODERATOR, MEMBER];

function stubGithubExchange(fixture: (typeof FIXTURES)[number]): void {
  nock('https://github.com')
    .post('/login/oauth/access_token')
    .reply(200, { access_token: 'test-access-token', token_type: 'bearer' });

  nock('https://api.github.com').get('/user').reply(200, {
    id: fixture.githubId,
    login: fixture.login,
    name: 'The Octocat',
    avatar_url: 'https://avatars.example.com/4',
  });

  nock('https://api.github.com')
    .get('/user/emails')
    .reply(200, [{ email: fixture.email, primary: true, verified: true }]);
}

function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

function namesOf(body: unknown): string[] {
  return (body as { name: string }[]).map((channel) => channel.name).sort();
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

async function loggedInAgent(
  app: INestApplication<App>,
  fixture: (typeof FIXTURES)[number],
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());
  const initial = await agent.get('/auth/github');
  stubGithubExchange(fixture);
  await agent.get(
    `/auth/github/callback?code=test-code&state=${extractState(initial.headers.location)}`,
  );
  return agent;
}

/**
 * The adversarial sweep that closes Phase 6.
 *
 * These belong with the code they test rather than with the PRD section 9
 * walk in Phase 10, which will re-run them rather than discover them. Each
 * scenario asserts a negative *and* the matching positive in the same test,
 * so a blanket-deny bug — the easiest way to pass a security test for the
 * wrong reason — cannot get through.
 */
describe('Channel access, adversarially (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    nock.enableNetConnect();
  });

  afterEach(async () => {
    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));

    // Servers first, then users: Membership.server is Cascade but
    // Membership.user is Restrict (data-model.md section 7).
    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    nock.cleanAll();
  });

  /** See `channels.e2e-spec.ts` for why the two budgets are reset by hand. */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function resetMutationBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function userIdOf(fixture: (typeof FIXTURES)[number]): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(fixture.githubId) },
    });
    if (user === null) throw new Error(`No user for ${fixture.login}`);
    return user.id.toString();
  }

  interface Seeded {
    serverId: string;
    /** A public channel everyone in the server can see. */
    publicId: string;
    /** A private channel with nobody seated in it. */
    privateId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
  }

  async function seed(): Promise<Seeded> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);

    const created = await owner.post('/servers').send({ name: 'Access Test' });
    const serverId = idOf(created.body);

    for (const [fixture, role] of [
      [MODERATOR, 'moderator'],
      [MEMBER, 'member'],
    ] as const) {
      await prisma.membership.create({
        data: {
          serverId: BigInt(serverId),
          userId: BigInt(await userIdOf(fixture)),
          role,
        },
      });
    }

    await resetMutationBudget();

    const open = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'general', isPrivate: false });
    const secret = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'secret', isPrivate: true });

    await resetMutationBudget();

    return {
      serverId,
      publicId: idOf(open.body),
      privateId: idOf(secret.body),
      owner,
      moderator,
      member,
    };
  }

  describe('a tampered client', () => {
    /**
     * Runs one attempt with a fresh `strict-mutation` budget.
     *
     * Without the reset the fourth mutating call answers 429 and the rest
     * never reach a guard at all. That the limiter also stops this is a real
     * second line of defence, not a problem — but it would make the test
     * about the limiter, when what it has to prove is that the *guard*
     * refuses each route on its own.
     */
    async function attempt(
      label: string,
      call: () => Promise<request.Response>,
    ): Promise<[string, number]> {
      await resetMutationBudget();

      return [label, (await call()).status];
    }

    it('is refused on every manage_settings route it calls directly', async () => {
      const { publicId, member } = await seed();
      const memberId = await userIdOf(MEMBER);

      // A public channel, so the member can plainly see it: every refusal
      // below is the capability, not the channel being hidden. The server
      // never trusts that the client hid the button (PRD section 9).
      const attempts = [
        await attempt('PATCH channel', () =>
          member.patch(`/channels/${publicId}`).send({ name: 'mine' }),
        ),
        await attempt('DELETE channel', () =>
          member.delete(`/channels/${publicId}`),
        ),
        await attempt('GET members', () =>
          member.get(`/channels/${publicId}/members`),
        ),
        await attempt('POST members', () =>
          member
            .post(`/channels/${publicId}/members`)
            .send({ userId: memberId }),
        ),
        await attempt('DELETE member', () =>
          member.delete(`/channels/${publicId}/members/${memberId}`),
        ),
        await attempt('GET overrides', () =>
          member.get(`/channels/${publicId}/overrides`),
        ),
        await attempt('PUT override', () =>
          member.put(`/channels/${publicId}/overrides/member/post`),
        ),
        await attempt('DELETE override', () =>
          member.delete(`/channels/${publicId}/overrides/member/post`),
        ),
      ];

      // Labelled rather than a bare list of eight numbers, so a failure names
      // the route that let them through.
      expect(attempts).toEqual([
        ['PATCH channel', 403],
        ['DELETE channel', 403],
        ['GET members', 403],
        ['POST members', 403],
        ['DELETE member', 403],
        ['GET overrides', 403],
        ['PUT override', 403],
        ['DELETE override', 403],
      ]);

      // And nothing moved.
      await expect(
        prisma.channel.findUniqueOrThrow({ where: { id: BigInt(publicId) } }),
      ).resolves.toMatchObject({ name: 'general' });
      await expect(prisma.channelOverride.findMany()).resolves.toEqual([]);
      await expect(prisma.channelMember.findMany()).resolves.toEqual([]);
    });

    it('still sees the read routes it is entitled to', async () => {
      const { serverId, publicId, member } = await seed();

      // The positive half. Without it a guard that denied everything would
      // pass the scenario above.
      expect((await member.get(`/channels/${publicId}`)).status).toBe(200);
      expect((await member.get(`/servers/${serverId}/channels`)).status).toBe(
        200,
      );
    });
  });

  describe('a private channel', () => {
    it('is invisible in every read path to a moderator who is not in it, and plain to the owner', async () => {
      const { serverId, privateId, moderator, owner } = await seed();
      const memberId = await userIdOf(MEMBER);

      const asModerator = {
        listing: namesOf(
          (await moderator.get(`/servers/${serverId}/channels`)).body,
        ),
        detail: (await moderator.get(`/channels/${privateId}`)).status,
        patch: (
          await moderator.patch(`/channels/${privateId}`).send({ name: 'mine' })
        ).status,
        members: (await moderator.get(`/channels/${privateId}/members`)).status,
        addMember: (
          await moderator
            .post(`/channels/${privateId}/members`)
            .send({ userId: memberId })
        ).status,
        overrides: (await moderator.get(`/channels/${privateId}/overrides`))
          .status,
      };
      await resetMutationBudget();

      // 404 everywhere, never 403: a private channel is fully hidden
      // (administration-service.md section 3), and a 403 would confirm it
      // exists.
      expect(asModerator).toEqual({
        listing: ['general'],
        detail: 404,
        patch: 404,
        members: 404,
        addMember: 404,
        overrides: 404,
      });

      const asOwner = {
        listing: namesOf(
          (await owner.get(`/servers/${serverId}/channels`)).body,
        ),
        detail: (await owner.get(`/channels/${privateId}`)).status,
        members: (await owner.get(`/channels/${privateId}/members`)).status,
        overrides: (await owner.get(`/channels/${privateId}/overrides`)).status,
      };

      // The same channel, the same routes, from the owner. A blanket-deny
      // bug cannot pass both halves.
      expect(asOwner).toEqual({
        listing: ['general', 'secret'],
        detail: 200,
        members: 200,
        overrides: 200,
      });
    });

    it('becomes visible to the moderator once they are seated in it', async () => {
      const { serverId, privateId, moderator, owner } = await seed();
      await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: await userIdOf(MODERATOR) });
      await resetMutationBudget();

      const listing = await moderator.get(`/servers/${serverId}/channels`);
      const detail = await moderator.get(`/channels/${privateId}`);

      expect(namesOf(listing.body)).toEqual(['general', 'secret']);
      expect(detail.status).toBe(200);
    });

    it('hides a public channel from members only when their view is revoked', async () => {
      const { serverId, publicId, owner, moderator, member } = await seed();

      await owner.put(`/channels/${publicId}/overrides/member/view`);
      await resetMutationBudget();

      // Gone for the role the override names, untouched for the other two.
      expect(
        namesOf((await member.get(`/servers/${serverId}/channels`)).body),
      ).toEqual([]);
      expect(
        namesOf((await moderator.get(`/servers/${serverId}/channels`)).body),
      ).toEqual(['general']);
      expect(
        namesOf((await owner.get(`/servers/${serverId}/channels`)).body),
      ).toEqual(['general', 'secret']);
    });
  });

  describe('there is no elevation path', () => {
    it('cannot give a member delete_others or manage_settings by any override write', async () => {
      const { publicId, owner, member } = await seed();

      // Every shape the API offers for the two capabilities a Member never
      // holds. PUT is the only writing verb, and it only ever revokes.
      const paths = [
        ['put', 'delete_others'],
        ['put', 'manage_settings'],
        ['delete', 'delete_others'],
        ['delete', 'manage_settings'],
      ] as const;

      const writes: number[] = [];
      for (const [verb, capability] of paths) {
        // Reset per call for the reason given in the tampered-client
        // scenario: the limiter refusing is not the answer under test.
        await resetMutationBudget();
        const url = `/channels/${publicId}/overrides/member/${capability}`;
        const response =
          verb === 'put' ? await owner.put(url) : await owner.delete(url);
        writes.push(response.status);
      }
      await resetMutationBudget();

      // The two revokes are refused as no-op tightens; the two restores
      // succeed and delete nothing, because a restore is not a grant.
      expect(writes).toEqual([400, 400, 204, 204]);
      await expect(prisma.channelOverride.findMany()).resolves.toEqual([]);

      // And the member's effective capability is exactly where it started.
      expect((await member.get(`/channels/${publicId}`)).status).toBe(200);
      expect(
        (await member.patch(`/channels/${publicId}`).send({ name: 'mine' }))
          .status,
      ).toBe(403);
      expect((await member.get(`/channels/${publicId}/members`)).status).toBe(
        403,
      );
    });

    it('cannot override the owner at all', async () => {
      const { publicId, owner } = await seed();

      const attempts = [
        (await owner.put(`/channels/${publicId}/overrides/owner/view`)).status,
        (
          await owner.put(
            `/channels/${publicId}/overrides/owner/manage_settings`,
          )
        ).status,
        (await owner.delete(`/channels/${publicId}/overrides/owner/post`))
          .status,
      ];

      // Unrepresentable in the port's types, and rejected at the edge where
      // the value arrives as an untyped URL segment.
      expect(attempts).toEqual([400, 400, 400]);
      await expect(prisma.channelOverride.findMany()).resolves.toEqual([]);
    });
  });
});
