import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MESSAGE_CONTENT_MAX } from '../src/chat/send-message.dto';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const OWNER = {
  githubId: 990100,
  login: 'octocat-messages-e2e-owner',
  email: 'octocat-messages-e2e-owner@example.com',
};

const MEMBER = {
  githubId: 990101,
  login: 'octocat-messages-e2e-member',
  email: 'octocat-messages-e2e-member@example.com',
};

const OUTSIDER = {
  githubId: 990102,
  login: 'octocat-messages-e2e-outsider',
  email: 'octocat-messages-e2e-outsider@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER];

/** The burst `message-send` absorbs before the bucket is empty. */
const SEND_CAPACITY = RATE_LIMIT_POLICIES['message-send'].capacity;

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

/** The `id` field off a created-resource response body. */
function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

/** The `error` object off a non-2xx body — see `common/errors.ts`'s own doc. */
function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error;
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

describe('POST /channels/:channelId/messages (e2e)', () => {
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
    // Membership.user is Restrict (data-model.md section 7). Messages go with
    // the channel, which goes with the server.
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

  /** See `channels.e2e-spec.ts` for why the budgets are reset by hand. */
  async function resetBudget(policy: string): Promise<void> {
    const keys = await redis.keys(`huddle:rl:${policy}:*`);
    if (keys.length > 0) await redis.del(...keys);
  }

  interface Seeded {
    serverId: string;
    /** A public channel everyone in the server can see. */
    channelId: string;
    /** A second public channel, for asserting the per-channel bucket scope. */
    siblingId: string;
    /** A private channel nobody has been seated in. */
    privateChannelId: string;
    owner: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
    outsider: ReturnType<typeof request.agent>;
  }

  /** A server with two public channels, one private one, and three callers. */
  async function seed(): Promise<Seeded> {
    const owner = await loggedInAgent(app, OWNER);
    await resetBudget('auth-ip');
    const member = await loggedInAgent(app, MEMBER);
    await resetBudget('auth-ip');
    const outsider = await loggedInAgent(app, OUTSIDER);

    const created = await owner.post('/servers').send({ name: 'Message Test' });
    const serverId = idOf(created.body);

    const memberUser = await prisma.user.findUnique({
      where: { githubId: String(MEMBER.githubId) },
    });
    if (memberUser === null) throw new Error('No user for the member fixture');
    await prisma.membership.create({
      data: {
        serverId: BigInt(serverId),
        userId: memberUser.id,
        role: 'member',
      },
    });

    await resetBudget('strict-mutation');
    const channel = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'alpha', isPrivate: false });
    const sibling = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'beta', isPrivate: false });
    await resetBudget('strict-mutation');
    const hidden = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'secret', isPrivate: true });
    await resetBudget('strict-mutation');

    return {
      serverId,
      channelId: idOf(channel.body),
      siblingId: idOf(sibling.body),
      privateChannelId: idOf(hidden.body),
      owner,
      member,
      outsider,
    };
  }

  describe('the happy path', () => {
    it('stores the message and returns 201 with it', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'hello there' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        channelId,
        content: 'hello there',
        editedAt: null,
        isDeleted: false,
      });

      // The row, not just the response — a handler that returned a plausible
      // body without writing anything would pass on the assertion above.
      const stored = await prisma.message.findUnique({
        where: { id: BigInt(idOf(response.body)) },
      });
      expect(stored?.content).toBe('hello there');
    });

    it('serialises every id as a JSON string, never a number', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'hello there' });

      const body = response.body as Record<string, unknown>;
      expect(typeof body['id']).toBe('string');
      expect(typeof body['channelId']).toBe('string');
      expect(typeof body['authorId']).toBe('string');

      // A `number` cannot hold 64 bits, so a numeric id in the raw text would
      // mean precision was already lost before the client ever parsed it.
      expect(response.text).toContain(`"id":"${idOf(response.body)}"`);
    });

    it('derives createdAt from the Snowflake, with no column to read it from', async () => {
      const { channelId, member } = await seed();
      const before = Date.now();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'hello there' });

      const createdAt = Date.parse(
        (response.body as { createdAt: string }).createdAt,
      );
      expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
      expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('trims the content before storing it', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: '  hello there \n' });

      expect(response.status).toBe(201);
      const stored = await prisma.message.findUnique({
        where: { id: BigInt(idOf(response.body)) },
      });
      expect(stored?.content).toBe('hello there');
    });

    it('lets the owner post without a ChannelMember row in a private channel', async () => {
      const { privateChannelId, owner } = await seed();

      const response = await owner
        .post(`/channels/${privateChannelId}/messages`)
        .send({ content: 'owners always can' });

      expect(response.status).toBe(201);
    });
  });

  describe('content validation', () => {
    it('rejects empty content with 400', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: '' });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
      await expect(prisma.message.count()).resolves.toBe(0);
    });

    it('rejects whitespace-only content with 400', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: '   \t\n  ' });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
      await expect(prisma.message.count()).resolves.toBe(0);
    });

    it('rejects content over the character cap with 400', async () => {
      const { channelId, member } = await seed();

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'a'.repeat(MESSAGE_CONTENT_MAX + 1) });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
      await expect(prisma.message.count()).resolves.toBe(0);
    });
  });

  describe('permission', () => {
    it('gives 403 to a member whose post an override revoked', async () => {
      const { channelId, member, owner } = await seed();

      await owner.put(`/channels/${channelId}/overrides/member/post`);
      await resetBudget('strict-mutation');

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'still allowed?' });

      // 403 rather than 404: the member can still *see* the channel, so there
      // is nothing left to hide. See RequireCapabilityGuard's own doc.
      expect(response.status).toBe(403);
      await expect(prisma.message.count()).resolves.toBe(0);
    });

    it('still lets the member post in a sibling channel the override did not touch', async () => {
      const { channelId, siblingId, member, owner } = await seed();

      await owner.put(`/channels/${channelId}/overrides/member/post`);
      await resetBudget('strict-mutation');

      const response = await member
        .post(`/channels/${siblingId}/messages`)
        .send({ content: 'this one is fine' });

      expect(response.status).toBe(201);
    });

    it('gives 404 to a non-member of a private channel', async () => {
      const { privateChannelId, member } = await seed();

      const response = await member
        .post(`/channels/${privateChannelId}/messages`)
        .send({ content: 'let me in' });

      // The hiding rule: a private channel is invisible, so the refusal must
      // not admit the id exists.
      expect(response.status).toBe(404);
      await expect(prisma.message.count()).resolves.toBe(0);
    });

    it('gives 404 to someone who is not in the server at all', async () => {
      const { channelId, outsider } = await seed();

      const response = await outsider
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'hello strangers' });

      expect(response.status).toBe(404);
    });

    it('gives 401 with no session', async () => {
      const { channelId } = await seed();

      const response = await request(app.getHttpServer())
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'anonymous' });

      expect(response.status).toBe(401);
    });
  });

  describe('the rate limit', () => {
    it(`returns 429 with Retry-After on send number ${SEND_CAPACITY + 1}`, async () => {
      const { channelId, member } = await seed();

      for (let i = 0; i < SEND_CAPACITY; i += 1) {
        const allowed = await member
          .post(`/channels/${channelId}/messages`)
          .send({ content: `message ${i}` });
        expect(allowed.status).toBe(201);
      }

      const response = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'one too many' });

      expect(response.status).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      // The handler never ran: the burst is stored, the rejected send is not.
      await expect(prisma.message.count()).resolves.toBe(SEND_CAPACITY);
    });

    it('does not spend another channel’s budget on the same burst', async () => {
      const { channelId, siblingId, member } = await seed();

      for (let i = 0; i < SEND_CAPACITY; i += 1) {
        await member
          .post(`/channels/${channelId}/messages`)
          .send({ content: `message ${i}` });
      }
      await expect(
        member
          .post(`/channels/${channelId}/messages`)
          .send({ content: 'exhausted' })
          .then((r) => r.status),
      ).resolves.toBe(429);

      // Same user, same second, different channel: `message-send` is
      // channel-dimensioned, so this bucket is untouched.
      const sibling = await member
        .post(`/channels/${siblingId}/messages`)
        .send({ content: 'a fresh bucket' });

      expect(sibling.status).toBe(201);
    });

    it('rejects a malformed channel id with 400, not 500', async () => {
      const { member } = await seed();

      // The rate limit guard runs before the pipe and must key a
      // channel-dimensioned bucket, so this is the first thing to see `abc`.
      const response = await member
        .post('/channels/abc/messages')
        .send({ content: 'hello' });

      expect(response.status).toBe(400);
    });
  });
});
