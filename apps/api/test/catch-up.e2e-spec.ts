import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import {
  CATCH_UP_LIMIT,
  type CatchUpAck,
  type CatchUpChannelResponse,
} from '../src/chat/catch-up.frame';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { SnowflakeService } from '../src/common/snowflake.service';

const OWNER = {
  githubId: 990600,
  login: 'octocat-catchup-owner',
  email: 'octocat-catchup-owner@example.com',
};

const MEMBER = {
  githubId: 990601,
  login: 'octocat-catchup-member',
  email: 'octocat-catchup-member@example.com',
};

const FIXTURES = [OWNER, MEMBER];

jest.setTimeout(30_000);

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

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Session {
  agent: ReturnType<typeof request.agent>;
  cookie: string;
}

describe('reconnect catch-up over the socket (e2e)', () => {
  let app: INestApplication<NetServer>;
  let prisma: PrismaService;
  let redis: RedisService;
  let snowflakes: SnowflakeService;
  let gateway: ChatGateway;
  let baseUrl: string;
  const openSockets: Socket[] = [];

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

    app.useWebSocketAdapter(new ChatIoAdapter(app));
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    if (address === null || typeof address === 'string') {
      throw new Error('HTTP server did not bind to a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    gateway = app.get(ChatGateway, { strict: false });
  });

  afterAll(async () => {
    for (const socket of openSockets.splice(0)) socket.close();
    await app.close();
    nock.enableNetConnect();
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) socket.close();

    // Servers first, then users: Membership.server is Cascade but
    // Membership.user is Restrict, and ChannelMember's user FK has no
    // cascade either.
    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));
    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });

    await flushKeys('huddle:rl:*');

    nock.cleanAll();
  });

  async function flushKeys(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }

  async function resetBudget(policy: string): Promise<void> {
    await flushKeys(`huddle:rl:${policy}:*`);
  }

  async function logIn(fixture: (typeof FIXTURES)[number]): Promise<Session> {
    const agent = request.agent(app.getHttpServer());
    const initial = await agent.get('/auth/github');
    stubGithubExchange(fixture);
    const callback = await agent.get(
      `/auth/github/callback?code=test-code&state=${extractState(initial.headers.location)}`,
    );
    const [setCookie] = callback.get('Set-Cookie') ?? [];
    const cookie = setCookie?.split(';')[0];
    if (cookie === undefined) {
      throw new Error('OAuth callback set no session cookie');
    }
    await resetBudget('auth-ip');
    return { agent, cookie };
  }

  function connect(cookie: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, {
        extraHeaders: { Cookie: cookie, Origin: 'http://localhost:5173' },
        reconnection: false,
      });
      socket.once('connect', () => {
        openSockets.push(socket);
        resolve(socket);
      });
      socket.once('connect_error', (error: Error) => {
        socket.close();
        reject(error);
      });
    });
  }

  /** Sends one `catch_up` frame and resolves with its single ack. */
  function emitCatchUp(socket: Socket, frame: unknown): Promise<CatchUpAck> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no catch_up ack within 5s')),
        5_000,
      );
      socket.emit('catch_up', frame, (ack: CatchUpAck) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  /** The reply half of an ack, or a loud failure if the frame errored. */
  function expectChannels(ack: CatchUpAck): CatchUpChannelResponse[] {
    if ('error' in ack) {
      throw new Error(`unexpected error ack: ${JSON.stringify(ack.error)}`);
    }
    return ack.channels;
  }

  function entryFor(
    channels: CatchUpChannelResponse[],
    channelId: string,
  ): CatchUpChannelResponse {
    const found = channels.find((entry) => entry.channelId === channelId);
    if (found === undefined) {
      throw new Error(`no entry for channel ${channelId}`);
    }
    return found;
  }

  async function userIdOf(githubId: number): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(githubId) },
    });
    if (user === null) throw new Error(`No user for githubId ${githubId}`);
    return user.id;
  }

  function roomsOf(userId: bigint): Set<string> {
    const rooms = new Set<string>();
    for (const socket of gateway.server.sockets.sockets.values()) {
      if (socket.data.user.id === userId) {
        for (const room of socket.rooms) {
          if (room !== socket.id) rooms.add(room);
        }
      }
    }
    return rooms;
  }

  async function waitForRooms(
    userId: bigint,
    expected: string[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const held = roomsOf(userId);
      if (expected.every((room) => held.has(room))) return;
      await sleep(20);
    }
    throw new Error(
      `rooms never settled: wanted [${expected.join(', ')}] got [${[...roomsOf(userId)].join(', ')}]`,
    );
  }

  /** Polls until the server has genuinely seen this user's socket drop. */
  async function waitUntilDropped(userId: bigint): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (roomsOf(userId).size === 0) return;
      await sleep(50);
    }
    throw new Error('socket never dropped server-side');
  }

  /**
   * Writes messages straight through the repository, the way
   * `messages.e2e-spec` seeds history: the send budget is five and these
   * tests need hundreds, while the ids still come from the real generator
   * so they stay unique and decode to an honest `createdAt`.
   */
  async function seedMessages(
    channelId: string,
    count: number,
    authorGithubId: number,
  ): Promise<string[]> {
    const author = await prisma.user.findUnique({
      where: { githubId: String(authorGithubId) },
    });
    if (author === null) {
      throw new Error(`No user for githubId ${authorGithubId}`);
    }

    const ids: string[] = [];
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

  interface Seeded {
    owner: Session;
    member: Session;
    serverId: string;
    alpha: string;
    secret: string;
  }

  /**
   * One server with a public channel (`alpha`) and a private one (`secret`)
   * the member is seated in — the channel access can be revoked from.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Catch-up Suite' }))
        .body,
    );
    await resetBudget('strict-mutation');

    const createChannel = async (
      name: string,
      isPrivate: boolean,
    ): Promise<string> => {
      const response = await owner.agent
        .post(`/servers/${serverId}/channels`)
        .send({ name, isPrivate });
      return idOf(response.body);
    };

    const alpha = await createChannel('alpha', false);
    const secret = await createChannel('secret', true);
    await resetBudget('strict-mutation');

    await prisma.membership.create({
      data: {
        serverId: BigInt(serverId),
        userId: await userIdOf(MEMBER.githubId),
        role: 'member',
      },
    });
    await prisma.channelMember.create({
      data: {
        channelId: BigInt(secret),
        userId: await userIdOf(MEMBER.githubId),
      },
    });

    return { owner, member, serverId, alpha, secret };
  }

  it('named: a client that dropped its socket gets exactly the three messages posted while it was away', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const initial = await seedMessages(seeded.alpha, 2, OWNER.githubId);
    const second = initial[1];
    if (second === undefined) throw new Error('seed failed');

    // A genuinely dropped socket: the client closes its own transport, the
    // server sees the disconnect and drops the rooms, and the client comes
    // back on a new socket — not a simulated gap on one live connection.
    const awaySocket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);
    awaySocket.disconnect();
    await waitUntilDropped(memberId);

    // Posted while the member was away.
    const awayIds = await seedMessages(seeded.alpha, 3, OWNER.githubId);

    const backSocket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ack = await emitCatchUp(backSocket, {
      channels: [{ channelId: seeded.alpha, afterMessageId: second }],
    });

    const channels = expectChannels(ack);
    expect(channels).toHaveLength(1);
    const entry = entryFor(channels, seeded.alpha);
    expect(entry.truncated).toBe(false);
    // Exactly the three it missed, oldest → newest — no gap, no replay of
    // what it already held.
    expect(entry.messages.map((message) => message.id)).toEqual(awayIds);
    expect(entry.messages[0]?.content).toBe('message 0');
    expect(
      entry.messages.every((message) => message.channelId === seeded.alpha),
    ).toBe(true);
  });

  it('one frame covering several channels returns all of them in a single ack, grouped by channel', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const alphaIds = await seedMessages(seeded.alpha, 3, OWNER.githubId);
    const secretIds = await seedMessages(seeded.secret, 2, OWNER.githubId);

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ack = await emitCatchUp(socket, {
      channels: [
        { channelId: seeded.alpha, afterMessageId: alphaIds[0] },
        { channelId: seeded.secret, afterMessageId: secretIds[0] },
      ],
    });

    // One frame, one ack — not one ack per channel.
    const channels = expectChannels(ack);
    expect(channels).toHaveLength(2);
    expect(channels.map((entry) => entry.channelId).sort()).toEqual(
      [seeded.alpha, seeded.secret].sort(),
    );

    const alpha = entryFor(channels, seeded.alpha);
    expect(alpha.messages.map((message) => message.id)).toEqual([
      alphaIds[1],
      alphaIds[2],
    ]);
    expect(alpha.truncated).toBe(false);

    const secret = entryFor(channels, seeded.secret);
    expect(secret.messages.map((message) => message.id)).toEqual([
      secretIds[1],
    ]);
    expect(secret.messages[0]?.channelId).toBe(seeded.secret);
  });

  it('caps a channel at the limit with truncated: true, leaving other channels in the same reply unaffected', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    // One cursor message, then more than the cap after it.
    const [cursor] = await seedMessages(seeded.alpha, 1, OWNER.githubId);
    if (cursor === undefined) throw new Error('cursor seed failed');
    await seedMessages(seeded.alpha, CATCH_UP_LIMIT + 10, OWNER.githubId);
    const secretIds = await seedMessages(seeded.secret, 3, OWNER.githubId);

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ack = await emitCatchUp(socket, {
      channels: [
        { channelId: seeded.alpha, afterMessageId: cursor },
        { channelId: seeded.secret, afterMessageId: secretIds[0] },
      ],
    });

    const channels = expectChannels(ack);
    const alpha = entryFor(channels, seeded.alpha);
    expect(alpha.messages).toHaveLength(CATCH_UP_LIMIT);
    expect(alpha.truncated).toBe(true);

    // The other channel in the very same reply is untouched by its
    // neighbour's truncation.
    const secret = entryFor(channels, seeded.secret);
    expect(secret.messages).toHaveLength(2);
    expect(secret.truncated).toBe(false);
  });

  it('a channel the caller lost access to while away is absent from the reply, with no error and no leak that it exists', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const alphaIds = await seedMessages(seeded.alpha, 2, OWNER.githubId);
    await seedMessages(seeded.secret, 2, OWNER.githubId);

    const awaySocket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);
    awaySocket.disconnect();
    await waitUntilDropped(memberId);

    // Access revoked while the client was away.
    await prisma.channelMember.deleteMany({
      where: {
        channelId: BigInt(seeded.secret),
        userId: memberId,
      },
    });

    const backSocket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha]);

    const secretCursor = await prisma.message.findFirst({
      where: { channelId: BigInt(seeded.secret) },
      orderBy: { id: 'desc' },
    });
    if (secretCursor === null) throw new Error('secret seed failed');

    const ack = await emitCatchUp(backSocket, {
      channels: [
        {
          channelId: seeded.secret,
          afterMessageId: secretCursor.id.toString(),
        },
        { channelId: seeded.alpha, afterMessageId: alphaIds[0] },
      ],
    });

    // No error for the revoked channel — and nothing in the reply that
    // could tell the caller the id resolved to anything at all.
    const channels = expectChannels(ack);
    expect(channels).toHaveLength(1);
    expect(entryFor(channels, seeded.alpha).messages).toHaveLength(1);
    expect(JSON.stringify(channels)).not.toContain(seeded.secret);
  });

  it('omits a channel revoked while the socket is still connected — visibility resolved at catch-up time, not trusted from the rooms', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const alphaIds = await seedMessages(seeded.alpha, 2, OWNER.githubId);
    const secretIds = await seedMessages(seeded.secret, 2, OWNER.githubId);

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    // No disconnect: the socket still holds the secret room, so a reply
    // keyed off the room set would leak — catch-up must re-resolve
    // visibility the way everything else does.
    await prisma.channelMember.deleteMany({
      where: { channelId: BigInt(seeded.secret), userId: memberId },
    });

    const ack = await emitCatchUp(socket, {
      channels: [
        { channelId: seeded.secret, afterMessageId: secretIds[0] },
        { channelId: seeded.alpha, afterMessageId: alphaIds[0] },
      ],
    });

    const channels = expectChannels(ack);
    expect(channels).toHaveLength(1);
    expect(entryFor(channels, seeded.alpha).messages).toHaveLength(1);
    expect(channels[0]?.channelId).toBe(seeded.alpha);
  });

  it('omits an unknown channel id rather than erroring — no existence oracle', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const alphaIds = await seedMessages(seeded.alpha, 2, OWNER.githubId);

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ghost = '990699999999999999';
    const ack = await emitCatchUp(socket, {
      channels: [
        { channelId: ghost, afterMessageId: alphaIds[0] },
        { channelId: seeded.alpha, afterMessageId: alphaIds[0] },
      ],
    });

    const channels = expectChannels(ack);
    expect(channels).toHaveLength(1);
    expect(channels[0]?.channelId).toBe(seeded.alpha);
    expect(JSON.stringify(channels)).not.toContain(ghost);
  });

  it('returns an empty list for a channel whose afterMessageId is already the newest', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const ids = await seedMessages(seeded.alpha, 2, OWNER.githubId);
    const newest = ids[ids.length - 1];
    if (newest === undefined) throw new Error('seed failed');

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ack = await emitCatchUp(socket, {
      channels: [{ channelId: seeded.alpha, afterMessageId: newest }],
    });

    // The channel is present — the client asked and can see it — it just
    // missed nothing.
    const channels = expectChannels(ack);
    const entry = entryFor(channels, seeded.alpha);
    expect(entry.messages).toEqual([]);
    expect(entry.truncated).toBe(false);
  });

  it('brings deleted messages back as placeholders, consistent with history', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const ids = await seedMessages(seeded.alpha, 3, OWNER.githubId);
    const [deleted] = ids;
    if (deleted === undefined) throw new Error('seed failed');

    // Soft-deleted the way #63 leaves a row: flag set, content blanked.
    await prisma.message.update({
      where: { id: BigInt(deleted) },
      data: { isDeleted: true, deletedAt: new Date(), content: '' },
    });

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    const ack = await emitCatchUp(socket, {
      channels: [
        {
          channelId: seeded.alpha,
          afterMessageId: '1',
        },
      ],
    });

    const entry = entryFor(expectChannels(ack), seeded.alpha);
    expect(entry.messages.map((message) => message.id)).toEqual(ids);
    const placeholder = entry.messages[0];
    expect(placeholder?.isDeleted).toBe(true);
    expect(placeholder?.content).toBeNull();
  });

  it('spends one read token per frame and refuses past the budget through the shared helper', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const socket = await connect(seeded.member.cookie);
    await waitForRooms(memberId, [seeded.alpha, seeded.secret]);

    // One empty frame each: the spend is per frame — the very reason a
    // client sends one frame instead of one per channel. 70 exceeds the
    // 60-token burst plus any realistic refill while they run.
    const refusals: CatchUpAck[] = [];
    let first: CatchUpAck | undefined;
    for (let index = 0; index < 70; index += 1) {
      const ack = await emitCatchUp(socket, { channels: [] });
      if (index === 0) first = ack;
      if ('error' in ack) refusals.push(ack);
    }

    expect(first !== undefined && 'error' in first).toBe(false);
    expect(refusals.length).toBeGreaterThan(0);
    for (const refusal of refusals) {
      if (!('error' in refusal)) throw new Error('expected an error ack');
      expect(refusal.error).toEqual({
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }
  });
});
