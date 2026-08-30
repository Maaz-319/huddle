import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990052,
  login: 'octocat-invites-e2e-owner',
  email: 'octocat-invites-e2e-owner@example.com',
};

const MEMBER = {
  githubId: 990053,
  login: 'octocat-invites-e2e-member',
  email: 'octocat-invites-e2e-member@example.com',
};

const MODERATOR = {
  githubId: 990054,
  login: 'octocat-invites-e2e-moderator',
  email: 'octocat-invites-e2e-moderator@example.com',
};

const OUTSIDER = {
  githubId: 990055,
  login: 'octocat-invites-e2e-outsider',
  email: 'octocat-invites-e2e-outsider@example.com',
};

const FIXTURES = [OWNER, MEMBER, MODERATOR, OUTSIDER];

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

/** The `id` field off a `POST /servers` response body. */
function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

/** The `code` field off an invite response body. */
function codeOf(body: unknown): string {
  return (body as { code: string }).code;
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

/** Logs in a fresh agent via the #31 OAuth flow, returning it with a live session cookie. */
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

describe('GET /servers/:serverId/invite (e2e)', () => {
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
    const githubIds = FIXTURES.map((f) => String(f.githubId));

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

  /**
   * Clears the per-IP login budget.
   *
   * `auth-ip` allows 5 tokens and a login spends 2, so a test needing three
   * real sessions would be throttled on the third. Supertest has no real
   * network hop to vary the caller address with, so the budget is reset
   * between logins rather than worked around by faking a user row -- these
   * cases are about what the HTTP surface does for each role, and a seeded
   * row with no session could not exercise the guard at all.
   */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /** OWNER's server with MEMBER and MODERATOR seated, all three holding sessions. */
  async function seedServer(memberInviteToggle: boolean): Promise<{
    serverId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
  }> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);

    const create = await owner.post('/servers').send({ name: 'Invite Test' });
    const serverId = idOf(create.body);

    if (!memberInviteToggle) {
      await owner
        .patch(`/servers/${serverId}`)
        .send({ memberInviteToggle: false });
    }

    const seat = async (fixture: (typeof FIXTURES)[number], role: string) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { githubId: String(fixture.githubId) },
      });
      await prisma.membership.create({
        data: {
          serverId: BigInt(serverId),
          userId: user.id,
          role: role === 'moderator' ? 'moderator' : 'member',
        },
      });
    };
    await seat(MODERATOR, 'moderator');
    await seat(MEMBER, 'member');

    return { serverId, owner, moderator, member };
  }

  it('returns the code the server was created with', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });

    const response = await owner.get(`/servers/${idOf(create.body)}/invite`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      code: expect.stringMatching(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/,
      ) as string,
      revokedAt: null,
      createdAt: expect.any(String) as string,
    });
    // The row id is deliberately not on the wire.
    expect(response.body).not.toHaveProperty('id');
  });

  it('serves an owner, a moderator, and -- with the toggle on -- a member', async () => {
    const { serverId, owner, moderator, member } = await seedServer(true);

    const asOwner = await owner.get(`/servers/${serverId}/invite`);
    const asModerator = await moderator.get(`/servers/${serverId}/invite`);
    const asMember = await member.get(`/servers/${serverId}/invite`);

    expect(asOwner.status).toBe(200);
    expect(asModerator.status).toBe(200);
    expect(asMember.status).toBe(200);
    // One server, one link: all three see the same code.
    expect(codeOf(asModerator.body)).toBe(codeOf(asOwner.body));
    expect(codeOf(asMember.body)).toBe(codeOf(asOwner.body));
  });

  it('rejects a member when the toggle is off, while the owner and moderator still get 200', async () => {
    const { serverId, owner, moderator, member } = await seedServer(false);

    const asOwner = await owner.get(`/servers/${serverId}/invite`);
    const asModerator = await moderator.get(`/servers/${serverId}/invite`);
    const asMember = await member.get(`/servers/${serverId}/invite`);

    // Both directions in one test: an implementation that gated everyone
    // would satisfy the rejection alone. Owner and Moderator ignore the
    // toggle entirely -- PRD section 5 gives them the capability outright.
    expect(asOwner.status).toBe(200);
    expect(asModerator.status).toBe(200);
    expect(asMember.status).toBe(403);
    expect(asMember.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('gives a non-member 403 and an unknown server 404', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const outsider = await loggedInAgent(app, OUTSIDER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });

    // The RequireRoleGuard disambiguation, exercised on this route: "you are
    // not in this server" and "this server does not exist" are different
    // answers, and a null membership alone cannot tell them apart.
    const forbidden = await outsider.get(
      `/servers/${idOf(create.body)}/invite`,
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const missing = await outsider.get('/servers/999000000000000001/invite');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns a revoked invite with revokedAt set, not a 404', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });
    const serverId = idOf(create.body);
    await prisma.invite.update({
      where: { serverId: BigInt(serverId) },
      data: { revokedAt: new Date() },
    });

    const response = await owner.get(`/servers/${serverId}/invite`);

    // A 404 here would make a revoked server look like a missing one, and the
    // client could not tell the user their link is dead.
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      revokedAt: expect.any(String) as string,
    });
  });

  it('lets the owner revoke, and revoking twice is a no-op', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });
    const serverId = idOf(create.body);

    const first = await owner.delete(`/servers/${serverId}/invite`);
    expect(first.status).toBe(204);

    const afterFirst = await prisma.invite.findUniqueOrThrow({
      where: { serverId: BigInt(serverId) },
    });

    const second = await owner.delete(`/servers/${serverId}/invite`);
    expect(second.status).toBe(204);

    const afterSecond = await prisma.invite.findUniqueOrThrow({
      where: { serverId: BigInt(serverId) },
    });
    // Revocation records when the link died, not when it was last asked to.
    expect(afterSecond.revokedAt).toEqual(afterFirst.revokedAt);
  });

  it('regenerates in place: new code, same row, revokedAt cleared', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });
    const serverId = idOf(create.body);
    const before = await prisma.invite.findUniqueOrThrow({
      where: { serverId: BigInt(serverId) },
    });
    await owner.delete(`/servers/${serverId}/invite`);

    const response = await owner.post(`/servers/${serverId}/invite/regenerate`);

    expect(response.status).toBe(200);
    expect(codeOf(response.body)).not.toBe(before.code);
    expect(response.body).toMatchObject({ revokedAt: null });

    const after = await prisma.invite.findUniqueOrThrow({
      where: { serverId: BigInt(serverId) },
    });
    // Same slot, new code -- and regenerating is how a revoked link comes
    // back, since there is no separate un-revoke.
    expect(after.id).toBe(before.id);
    expect(after.revokedAt).toBeNull();
  });

  it('lets a moderator revoke and regenerate', async () => {
    const { serverId, moderator } = await seedServer(true);

    const revoke = await moderator.delete(`/servers/${serverId}/invite`);
    expect(revoke.status).toBe(204);

    const regenerate = await moderator.post(
      `/servers/${serverId}/invite/regenerate`,
    );
    expect(regenerate.status).toBe(200);
  });

  it('refuses a member both routes even with memberInviteToggle on', async () => {
    const { serverId, member } = await seedServer(true);

    // The one place the two invite permissions could plausibly be conflated.
    // PRD section 5 is explicit: revoke/regenerate is Owner and Moderator
    // only. A member who can read the code can never destroy it.
    const read = await member.get(`/servers/${serverId}/invite`);
    expect(read.status).toBe(200);

    const revoke = await member.delete(`/servers/${serverId}/invite`);
    expect(revoke.status).toBe(403);

    const regenerate = await member.post(
      `/servers/${serverId}/invite/regenerate`,
    );
    expect(regenerate.status).toBe(403);
  });

  it('spends the strict-mutation budget, returning 429 with Retry-After', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const create = await owner.post('/servers').send({ name: 'Invite Test' });
    const serverId = idOf(create.body);

    // POST /servers already spent one token, so the budget of 3 leaves two
    // regenerates before the third is refused.
    await owner.post(`/servers/${serverId}/invite/regenerate`);
    await owner.post(`/servers/${serverId}/invite/regenerate`);
    const throttled = await owner.post(
      `/servers/${serverId}/invite/regenerate`,
    );

    expect(throttled.status).toBe(429);
    expect(throttled.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unauthenticated read with 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/servers/999000000000000001/invite',
    );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});
