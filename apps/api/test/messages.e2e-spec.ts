import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MESSAGE_CONTENT_MAX } from '../src/chat/send-message.dto';
import { DEFAULT_PAGE_SIZE } from '../src/common/pagination.dto';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { SnowflakeService } from '../src/common/snowflake.service';
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

describe('the channel message routes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let snowflakes: SnowflakeService;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    snowflakes = moduleFixture.get(SnowflakeService);
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

  describe('PATCH /channels/:channelId/messages/:messageId', () => {
    it('updates the content and returns 200 with the edited message', async () => {
      const { channelId, member } = await seed();
      const sent = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'original' });
      const messageId = idOf(sent.body);

      const response = await member
        .patch(`/channels/${channelId}/messages/${messageId}`)
        .send({ content: 'edited' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        content: 'edited',
        isDeleted: false,
      });
      const body = response.body as { editedAt: string | null };
      expect(body.editedAt).not.toBeNull();

      const stored = await prisma.message.findUnique({
        where: { id: BigInt(messageId) },
      });
      expect(stored?.content).toBe('edited');
    });

    it('gives 403 when the caller is not the author', async () => {
      const { channelId, member, owner } = await seed();
      const sent = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'mine' });
      const messageId = idOf(sent.body);

      // The owner is not the author of member's message.
      const response = await owner
        .patch(`/channels/${channelId}/messages/${messageId}`)
        .send({ content: 'hijacked' });

      expect(response.status).toBe(403);
    });

    it('gives 404 when the message belongs to a different channel', async () => {
      const { channelId, siblingId, member } = await seed();
      const sent = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'here' });
      const messageId = idOf(sent.body);

      const response = await member
        .patch(`/channels/${siblingId}/messages/${messageId}`)
        .send({ content: 'wrong channel' });

      expect(response.status).toBe(404);
    });

    it('rejects editing a soft-deleted message with 400', async () => {
      const { channelId, member } = await seed();
      const sent = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'doomed' });
      const messageId = idOf(sent.body);

      await prisma.message.update({
        where: { id: BigInt(messageId) },
        data: { isDeleted: true, deletedAt: new Date(), content: '' },
      });

      const response = await member
        .patch(`/channels/${channelId}/messages/${messageId}`)
        .send({ content: 'undelete' });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).message).toContain('deleted');
    });

    it('gives 403 to a member whose post an override revoked', async () => {
      const { channelId, member, owner } = await seed();
      const sent = await member
        .post(`/channels/${channelId}/messages`)
        .send({ content: 'mine' });
      const messageId = idOf(sent.body);

      await owner.put(`/channels/${channelId}/overrides/member/post`);
      await resetBudget('strict-mutation');

      const response = await member
        .patch(`/channels/${channelId}/messages/${messageId}`)
        .send({ content: 'nope' });

      expect(response.status).toBe(403);
    });

    it('gives 401 with no session', async () => {
      const { channelId } = await seed();

      const response = await request(app.getHttpServer())
        .patch(`/channels/${channelId}/messages/123`)
        .send({ content: 'anonymous' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /channels/:channelId/messages', () => {
    /** `count` messages posted straight into the table, oldest first. */
    async function seedHistory(
      channelId: string,
      count: number,
    ): Promise<string[]> {
      const author = await prisma.user.findUnique({
        where: { githubId: String(MEMBER.githubId) },
      });
      if (author === null) throw new Error('No user for the member fixture');

      const ids: string[] = [];
      // Written directly rather than through the route: the send budget is
      // five, and this needs far more than five messages. The ids still come
      // from the real generator rather than being minted by hand, so they
      // stay unique across two calls in the same millisecond and decode to an
      // honest createdAt.
      for (let index = 0; index < count; index += 1) {
        const created = await prisma.message.create({
          data: {
            id: snowflakes.generate(),
            channelId: BigInt(channelId),
            authorId: author.id,
            content: `message ${index}`,
          },
        });
        ids.push(created.id.toString());
      }

      return ids;
    }

    function pageOf(body: unknown): {
      messages: { id: string; content: string | null; isDeleted: boolean }[];
      hasMore: boolean;
    } {
      return body as {
        messages: { id: string; content: string | null; isDeleted: boolean }[];
        hasMore: boolean;
      };
    }

    it('returns the newest page, of the default size, with no cursor', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, DEFAULT_PAGE_SIZE + 10);

      const response = await member.get(`/channels/${channelId}/messages`);

      expect(response.status).toBe(200);
      const page = pageOf(response.body);
      expect(page.messages).toHaveLength(DEFAULT_PAGE_SIZE);
      expect(page.hasMore).toBe(true);
      // The newest ones, oldest-first within the page.
      expect(page.messages[page.messages.length - 1]?.id).toBe(
        ids[ids.length - 1],
      );
    });

    it('pages backwards with ?before=, oldest → newest within the page', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 10);

      const response = await member.get(
        `/channels/${channelId}/messages?before=${ids[5]}&limit=3`,
      );

      expect(pageOf(response.body).messages.map((m) => m.id)).toEqual([
        ids[2],
        ids[3],
        ids[4],
      ]);
    });

    it('skips and duplicates nothing when a message arrives between two pages', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 6);

      const first = pageOf(
        (await member.get(`/channels/${channelId}/messages?limit=2`)).body,
      );

      // Actually inserted between the two calls — the situation offset paging
      // gets wrong, and the only reason the cursor is a Snowflake.
      await seedHistory(channelId, 1);

      const second = pageOf(
        (
          await member.get(
            `/channels/${channelId}/messages?before=${first.messages[0]?.id}&limit=2`,
          )
        ).body,
      );

      expect(first.messages.map((m) => m.id)).toEqual([ids[4], ids[5]]);
      expect(second.messages.map((m) => m.id)).toEqual([ids[2], ids[3]]);
    });

    it('returns only messages newer than ?after=, in the same order', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 6);

      const response = await member.get(
        `/channels/${channelId}/messages?after=${ids[2]}`,
      );

      const page = pageOf(response.body);
      expect(page.messages.map((m) => m.id)).toEqual([ids[3], ids[4], ids[5]]);
      expect(page.hasMore).toBe(false);
    });

    it('reports hasMore true with one row left and false on the last page', async () => {
      const { channelId, member } = await seed();
      await seedHistory(channelId, 4);

      const partial = await member.get(
        `/channels/${channelId}/messages?limit=3`,
      );
      const whole = await member.get(`/channels/${channelId}/messages?limit=4`);

      expect(pageOf(partial.body).hasMore).toBe(true);
      expect(pageOf(whole.body).hasMore).toBe(false);
    });

    it('rejects both cursors together with 400, saying they are exclusive', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 3);

      const response = await member.get(
        `/channels/${channelId}/messages?before=${ids[2]}&after=${ids[0]}`,
      );

      expect(response.status).toBe(400);
      expect(response.text).toContain('mutually exclusive');
    });

    it('rejects a limit over the ceiling with 400', async () => {
      const { channelId, member } = await seed();

      const response = await member.get(
        `/channels/${channelId}/messages?limit=101`,
      );

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
    });

    it('renders a soft-deleted message as a placeholder, text and all', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 3);
      await prisma.message.update({
        where: { id: BigInt(ids[1] ?? '0') },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      const response = await member.get(`/channels/${channelId}/messages`);

      const page = pageOf(response.body);
      // Included and counted, so page boundaries stay stable.
      expect(page.messages).toHaveLength(3);
      expect(page.messages[1]).toMatchObject({
        id: ids[1],
        content: null,
        isDeleted: true,
      });
      // The stored text is still in the row here — #63 is what blanks it —
      // so this asserts the response is what withholds it.
      expect(response.text).not.toContain('message 1');
    });

    it('gives 404, not 403, to a caller without effective view', async () => {
      const { channelId, member, owner } = await seed();
      await seedHistory(channelId, 2);

      await owner.put(`/channels/${channelId}/overrides/member/view`);
      await resetBudget('strict-mutation');

      const response = await member.get(`/channels/${channelId}/messages`);

      // A revoked `view` hides the channel rather than admitting it is there:
      // a 403 would confirm the existence of something the listing filters out.
      expect(response.status).toBe(404);
    });

    it('gives 404 to a non-member of a private channel', async () => {
      const { privateChannelId, member } = await seed();

      const response = await member.get(
        `/channels/${privateChannelId}/messages`,
      );

      expect(response.status).toBe(404);
    });

    it('serialises message ids as JSON strings inside the page', async () => {
      const { channelId, member } = await seed();
      const ids = await seedHistory(channelId, 2);

      const response = await member.get(`/channels/${channelId}/messages`);

      expect(response.text).toContain(`"id":"${ids[0]}"`);
    });

    it('returns an empty page for a channel with no messages', async () => {
      const { channelId, member } = await seed();

      const response = await member.get(`/channels/${channelId}/messages`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ messages: [], hasMore: false });
    });
  });
});
