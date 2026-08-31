import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990090,
  login: 'octocat-overrides-e2e-owner',
  email: 'octocat-overrides-e2e-owner@example.com',
};

const MODERATOR = {
  githubId: 990091,
  login: 'octocat-overrides-e2e-moderator',
  email: 'octocat-overrides-e2e-moderator@example.com',
};

const MEMBER = {
  githubId: 990092,
  login: 'octocat-overrides-e2e-member',
  email: 'octocat-overrides-e2e-member@example.com',
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

/** The `error` object off a non-2xx body — see `common/errors.ts`'s own doc. */
function errorOf(body: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  return (
    body as {
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    }
  ).error;
}

function pairsOf(body: unknown): string[] {
  return (body as { role: string; capability: string }[]).map(
    (override) => `${override.role}:${override.capability}`,
  );
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

describe('The channel override API (e2e)', () => {
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

  interface Seeded {
    serverId: string;
    /** Channel A — where the tightening happens. */
    channelId: string;
    /** Channel B — the untouched sibling, for asserting the scope. */
    siblingId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
  }

  /** A server with two public channels and all three roles logged in. */
  async function seed(): Promise<Seeded> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);

    const created = await owner
      .post('/servers')
      .send({ name: 'Override Test' });
    const serverId = idOf(created.body);

    for (const [fixture, role] of [
      [MODERATOR, 'moderator'],
      [MEMBER, 'member'],
    ] as const) {
      const user = await prisma.user.findUnique({
        where: { githubId: String(fixture.githubId) },
      });
      if (user === null) throw new Error(`No user for ${fixture.login}`);
      await prisma.membership.create({
        data: { serverId: BigInt(serverId), userId: user.id, role },
      });
    }

    await resetMutationBudget();

    const channel = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'alpha', isPrivate: false });
    const sibling = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'beta', isPrivate: false });

    await resetMutationBudget();

    return {
      serverId,
      channelId: idOf(channel.body),
      siblingId: idOf(sibling.body),
      owner,
      moderator,
      member,
    };
  }

  describe('validation', () => {
    it('rejects :role=owner with 400', async () => {
      const { channelId, owner } = await seed();

      const response = await owner.put(
        `/channels/${channelId}/overrides/owner/view`,
      );

      // The Owner is never overridable. The port makes an owner override
      // unrepresentable in TypeScript; this is the same rule at the edge.
      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
      await expect(prisma.channelOverride.findMany()).resolves.toEqual([]);
    });

    it.each([['delete_others'], ['manage_settings']])(
      'rejects member + %s with 400 and says why',
      async (capability) => {
        const { channelId, owner } = await seed();

        const response = await owner.put(
          `/channels/${channelId}/overrides/member/${capability}`,
        );

        expect(response.status).toBe(400);
        // "Invalid" would not fix the misunderstanding behind the request.
        expect(errorOf(response.body).message).toContain(
          `A member does not hold ${capability} server-wide`,
        );
        await expect(prisma.channelOverride.findMany()).resolves.toEqual([]);
      },
    );

    it.each([['admin'], ['nobody']])(
      'rejects the unknown role %p with 400',
      async (role) => {
        const { channelId, owner } = await seed();

        const response = await owner.put(
          `/channels/${channelId}/overrides/${role}/view`,
        );

        expect(response.status).toBe(400);
      },
    );

    it.each([['read'], ['everything']])(
      'rejects the unknown capability %p with 400',
      async (capability) => {
        const { channelId, owner } = await seed();

        const response = await owner.put(
          `/channels/${channelId}/overrides/moderator/${capability}`,
        );

        expect(response.status).toBe(400);
      },
    );

    it.each([
      ['moderator', 'view'],
      ['moderator', 'post'],
      ['moderator', 'delete_others'],
      ['moderator', 'manage_settings'],
      ['member', 'view'],
      ['member', 'post'],
    ])('accepts %s + %s', async (role, capability) => {
      const { channelId, owner } = await seed();

      const response = await owner.put(
        `/channels/${channelId}/overrides/${role}/${capability}`,
      );

      expect(response.status).toBe(204);
    });
  });

  describe('idempotency', () => {
    it('revoking twice is 204 both times and leaves one row', async () => {
      const { channelId, owner } = await seed();

      const first = await owner.put(
        `/channels/${channelId}/overrides/member/post`,
      );
      const second = await owner.put(
        `/channels/${channelId}/overrides/member/post`,
      );

      expect([first.status, second.status]).toEqual([204, 204]);
      await expect(prisma.channelOverride.findMany()).resolves.toHaveLength(1);
    });

    it('restoring a pair that was never revoked is 204', async () => {
      const { channelId, owner } = await seed();

      const response = await owner.delete(
        `/channels/${channelId}/overrides/member/view`,
      );

      expect(response.status).toBe(204);
    });
  });

  describe('GET', () => {
    it('lists what has been revoked on this channel only', async () => {
      const { channelId, siblingId, owner } = await seed();
      await owner.put(`/channels/${channelId}/overrides/member/post`);
      await owner.put(`/channels/${channelId}/overrides/moderator/post`);
      await owner.put(`/channels/${siblingId}/overrides/member/view`);
      await resetMutationBudget();

      const here = await owner.get(`/channels/${channelId}/overrides`);
      const there = await owner.get(`/channels/${siblingId}/overrides`);

      expect(pairsOf(here.body).sort()).toEqual([
        'member:post',
        'moderator:post',
      ]);
      expect(pairsOf(there.body)).toEqual(['member:view']);
    });
  });

  describe('a revoked capability, end to end', () => {
    it('bites in channel A, leaves channel B alone, and lifts on restore', async () => {
      const { channelId, siblingId, owner, member } = await seed();

      // Post is not wired to a route yet, so manage_settings on a member is
      // not usable as the probe either -- they never hold it. `view` is the
      // capability with a route today, and a revoked `view` renders as 404.
      await owner.put(`/channels/${channelId}/overrides/member/view`);
      await resetMutationBudget();

      const blocked = await member.get(`/channels/${channelId}`);
      const elsewhere = await member.get(`/channels/${siblingId}`);

      // Both directions: a blanket-deny bug would pass the first alone.
      expect(blocked.status).toBe(404);
      expect(elsewhere.status).toBe(200);

      await owner.delete(`/channels/${channelId}/overrides/member/view`);
      await resetMutationBudget();

      const restored = await member.get(`/channels/${channelId}`);
      expect(restored.status).toBe(200);
    });

    it('does not touch the moderator or the owner', async () => {
      const { channelId, owner, moderator } = await seed();
      await owner.put(`/channels/${channelId}/overrides/member/view`);

      // The revocation names `member`, so it applies to that role and no
      // other. The owner would pass regardless -- they are never overridable.
      await expect(
        moderator.get(`/channels/${channelId}`).then((r) => r.status),
      ).resolves.toBe(200);
      await expect(
        owner.get(`/channels/${channelId}`).then((r) => r.status),
      ).resolves.toBe(200);
    });
  });

  describe('who may write an override', () => {
    it('lets a moderator write one where they hold manage_settings', async () => {
      const { channelId, moderator } = await seed();

      const response = await moderator.put(
        `/channels/${channelId}/overrides/member/post`,
      );

      // PRD section 5: "Apply channel-level overrides — Owner, Moderator".
      expect(response.status).toBe(204);
    });

    it('refuses that moderator where manage_settings has been revoked', async () => {
      const { channelId, siblingId, owner, moderator } = await seed();
      await owner.put(
        `/channels/${channelId}/overrides/moderator/manage_settings`,
      );
      await resetMutationBudget();

      const here = await moderator.put(
        `/channels/${channelId}/overrides/member/post`,
      );
      const there = await moderator.put(
        `/channels/${siblingId}/overrides/member/post`,
      );

      expect(here.status).toBe(403);
      expect(there.status).toBe(204);
    });

    it('leaves the owner as the way back from a moderator self-lockout', async () => {
      const { channelId, moderator, owner } = await seed();

      // A moderator may lock their own peers out of a channel's settings.
      await moderator.put(
        `/channels/${channelId}/overrides/moderator/manage_settings`,
      );
      await resetMutationBudget();

      expect(
        (await moderator.get(`/channels/${channelId}/overrides`)).status,
      ).toBe(403);

      // Intended, not a bug: the owner is never overridable.
      const undone = await owner.delete(
        `/channels/${channelId}/overrides/moderator/manage_settings`,
      );
      expect(undone.status).toBe(204);
      expect(
        (await moderator.get(`/channels/${channelId}/overrides`)).status,
      ).toBe(200);
    });

    it('refuses a member on all three routes', async () => {
      const { channelId, member } = await seed();

      const statuses = [
        (await member.get(`/channels/${channelId}/overrides`)).status,
        (await member.put(`/channels/${channelId}/overrides/member/post`))
          .status,
        (await member.delete(`/channels/${channelId}/overrides/member/post`))
          .status,
      ];

      expect(statuses).toEqual([403, 403, 403]);
    });
  });
});
