import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import { RedisChatStateStore } from '../src/chat/adapters/redis-chat-state-store.adapter';
import { ChatStateStore } from '../src/chat/chat-state-store.interface';
import type { MessageResponse } from '../src/chat/message-response';
import type { SendAck } from '../src/chat/message-send.frame';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const OWNER = {
  githubId: 990300,
  login: 'octocat-send-owner',
  email: 'octocat-send-owner@example.com',
};

const MEMBER = {
  githubId: 990301,
  login: 'octocat-send-member',
  email: 'octocat-send-member@example.com',
};

const OUTSIDER = {
  githubId: 990302,
  login: 'octocat-send-outsider',
  email: 'octocat-send-outsider@example.com',
};

const MOD = {
  githubId: 990303,
  login: 'octocat-send-mod',
  email: 'octocat-send-mod@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER, MOD];

/** The burst `message-send` absorbs before the bucket is empty. */
const SEND_CAPACITY = RATE_LIMIT_POLICIES['message-send'].capacity;

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

/** The `id` field off a created-resource response body. */
function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Session {
  agent: ReturnType<typeof request.agent>;
  cookie: string;
}

describe('sending a message over the socket (e2e)', () => {
  let app: INestApplication<NetServer>;
  let prisma: PrismaService;
  let redis: RedisService;
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

    // Before init, or the gateway boots against the default adapter and the
    // handshake middleware never registers.
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
    // Membership.user is Restrict, and ChannelMember's user FK has no cascade
    // either — deleting the servers cascades the channels and their members,
    // which leaves the user rows deletable.
    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));
    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });

    await flushKeys('huddle:rl:*');
    // Idempotency keys are per-user Snowflake ids, so nothing collides
    // across runs on its own — flushed for hygiene, like the rate buckets
    // (everything Redis holds here is ephemeral by design, AGENTS.md §8).
    await flushKeys('huddle:chat:send:*');

    nock.cleanAll();
  });

  async function flushKeys(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }

  /** See `channels.e2e-spec.ts` for why the budgets are reset by hand. */
  async function resetBudget(policy: string): Promise<void> {
    await flushKeys(`huddle:rl:${policy}:*`);
  }

  /** Logs in through the OAuth flow and hands back both the REST agent and the session cookie. */
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

  /** Opens a connection that must succeed. */
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

  /** Emits `message_send` and resolves with the sender's direct ack. */
  function sendFrame(
    socket: Socket,
    frame: {
      channelId: string;
      content: string;
      idempotencyKey: string;
    },
  ): Promise<SendAck> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no ack for message_send within 5s')),
        5_000,
      );
      socket.emit('message_send', frame, (ack: SendAck) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  /** Resolves with the next `message_create` this socket receives. */
  function nextMessage(socket: Socket): Promise<MessageResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no message_create within 5s')),
        5_000,
      );
      socket.once('message_create', (message: MessageResponse) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  /** Starts counting `message_create` deliveries without waiting for one. */
  function collectMessages(socket: Socket): MessageResponse[] {
    const received: MessageResponse[] = [];
    socket.on('message_create', (message: MessageResponse) => {
      received.push(message);
    });
    return received;
  }

  async function userIdOf(githubId: number): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(githubId) },
    });
    if (user === null) throw new Error(`No user for githubId ${githubId}`);
    return user.id;
  }

  /** Channel rooms of every socket carrying this user, minus the private id room. */
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

  /**
   * Polls until the user's sockets hold every room in `expected` (joins run
   * asynchronously after `connect` resolves). Used as a "these rooms are
   * ready to receive" barrier, not as an exact-set assertion — the exact set
   * is #64's suite's job.
   */
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
      `rooms never settled: wanted [${expected.join(', ')}] got [${sorted(roomsOf(userId)).join(', ')}]`,
    );
  }

  interface Seeded {
    owner: Session;
    member: Session;
    outsider: Session;
    mod: Session;
    serverId: string;
    alpha: string;
    secret: string;
  }

  /**
   * One server with a public channel (`alpha`) and a private one (`secret`).
   * The member is seated in the private channel, the moderator — a moderator
   * in the server — is not, and the outsider is in no server at all.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const outsider = await logIn(OUTSIDER);
    const mod = await logIn(MOD);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Send Suite' })).body,
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

    const memberUser = await userIdOf(MEMBER.githubId);
    const modUser = await userIdOf(MOD.githubId);
    await prisma.membership.createMany({
      data: [
        { serverId: BigInt(serverId), userId: memberUser, role: 'member' },
        { serverId: BigInt(serverId), userId: modUser, role: 'moderator' },
      ],
    });
    await prisma.channelMember.create({
      data: { channelId: BigInt(secret), userId: memberUser },
    });

    return { owner, member, outsider, mod, serverId, alpha, secret };
  }

  /** Connects the four sessions and waits until their rooms are as seeded. */
  async function connectAll(seeded: Seeded): Promise<{
    ownerSocket: Socket;
    memberSocket: Socket;
    outsiderSocket: Socket;
    modSocket: Socket;
  }> {
    const [ownerSocket, memberSocket, outsiderSocket, modSocket] =
      await Promise.all([
        connect(seeded.owner.cookie),
        connect(seeded.member.cookie),
        connect(seeded.outsider.cookie),
        connect(seeded.mod.cookie),
      ]);

    await waitForRooms(await userIdOf(OWNER.githubId), [
      seeded.alpha,
      seeded.secret,
    ]);
    await waitForRooms(await userIdOf(MEMBER.githubId), [
      seeded.alpha,
      seeded.secret,
    ]);
    await waitForRooms(await userIdOf(MOD.githubId), [seeded.alpha]);

    return { ownerSocket, memberSocket, outsiderSocket, modSocket };
  }

  async function rowsIn(channelId: string): Promise<number> {
    return prisma.message.count({ where: { channelId: BigInt(channelId) } });
  }

  /** The success half of a `SendAck`, or a loud failure if it was an error. */
  function requireSuccess(ack: SendAck): {
    idempotencyKey: string;
    messageId: string;
    createdAt: string;
  } {
    if (!('messageId' in ack)) {
      throw new Error(`expected a success ack, got ${JSON.stringify(ack)}`);
    }
    return ack;
  }

  it("delivers one client's message to the other client in the room — the PRD §9 scenario", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);
    const key = 'prd-9-scenario-key';

    // Listeners first: the ack is written before the broadcast, so a promise
    // per expected delivery is created before anything can be emitted.
    const ownerReceives = nextMessage(ownerSocket);
    const memberReceives = nextMessage(memberSocket);

    const ack = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'hello from the member',
      idempotencyKey: key,
    });

    // The sender's direct ack: its own key, the new message's id, its
    // creation time — separate from the broadcast it also receives.
    const success = requireSuccess(ack);
    expect(success.idempotencyKey).toBe(key);
    expect(success.messageId).toMatch(/^\d+$/);
    expect(success.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    // The other client receives message_create with the full message.
    const ownerView = await ownerReceives;
    expect(ownerView).toEqual({
      id: success.messageId,
      channelId: seeded.alpha,
      authorId: memberId.toString(),
      author: {
        id: memberId.toString(),
        username: MEMBER.login,
        avatarUrl: 'https://avatars.example.com/4',
      },
      content: 'hello from the member',
      createdAt: success.createdAt,
      editedAt: null,
      isDeleted: false,
    });

    // The sender's own broadcast loops back too — it is not suppressed; the
    // sender's UI just does not wait for it.
    const senderView = await memberReceives;
    expect(senderView).toEqual({ ...ownerView, idempotencyKey: key });

    // And it is a real row, not an echo.
    await expect(rowsIn(seeded.alpha)).resolves.toBe(1);
    expect(ownerId).not.toBe(memberId);
  });

  it('dedupes a repeated idempotency key inside the window: one row, two identical acks, one broadcast', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const key = 'replayed-key';
    const broadcasts = collectMessages(ownerSocket);

    const first = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'sent once',
      idempotencyKey: key,
    });
    const second = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'sent once',
      idempotencyKey: key,
    });

    // Same ack twice: the client that retried cannot tell, which is the
    // point — it stops retrying into a duplicate.
    expect(second).toEqual(first);
    await expect(rowsIn(seeded.alpha)).resolves.toBe(1);

    // The judgment call, asserted: a replayed ack does NOT re-broadcast —
    // the room already saw this message, and replaying it would duplicate
    // every client's history for a client-side retry.
    await sleep(300);
    expect(broadcasts).toHaveLength(1);
  });

  it('creates a second message once the retention window has passed', async () => {
    const seeded = await seed();
    const { memberSocket } = await connectAll(seeded);

    const store = app.get(ChatStateStore);
    if (!(store instanceof RedisChatStateStore)) {
      throw new Error('Expected the Redis-backed ChatStateStore');
    }

    // The adapter's TTL is injectable precisely so this test does not sleep
    // for the real 30 seconds (documented in the PR).
    const originalTtl = store.ttlMs;
    store.ttlMs = 1_000;

    try {
      const key = 'across-the-window';
      const first = requireSuccess(
        await sendFrame(memberSocket, {
          channelId: seeded.alpha,
          content: 'first window',
          idempotencyKey: key,
        }),
      );

      await sleep(1_300);

      const second = requireSuccess(
        await sendFrame(memberSocket, {
          channelId: seeded.alpha,
          content: 'first window',
          idempotencyKey: key,
        }),
      );

      expect(second.messageId).not.toBe(first.messageId);
      await expect(rowsIn(seeded.alpha)).resolves.toBe(2);
    } finally {
      store.ttlMs = originalTtl;
    }
  });

  it('scopes idempotency keys per user: the same nonce, two users, two messages', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const key = 'shared-nonce';

    const ownerAck = requireSuccess(
      await sendFrame(ownerSocket, {
        channelId: seeded.alpha,
        content: 'from the owner',
        idempotencyKey: key,
      }),
    );
    const memberAck = requireSuccess(
      await sendFrame(memberSocket, {
        channelId: seeded.alpha,
        content: 'from the member',
        idempotencyKey: key,
      }),
    );

    expect(ownerAck.idempotencyKey).toBe(key);
    expect(memberAck.idempotencyKey).toBe(key);
    expect(ownerAck.messageId).not.toBe(memberAck.messageId);
    await expect(rowsIn(seeded.alpha)).resolves.toBe(2);
  });

  it('refuses a member whose post an override revoked — no row, no broadcast, non-retryable', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(seeded.alpha),
        role: 'member',
        capability: 'post',
      },
    });

    const broadcasts = collectMessages(ownerSocket);

    const key = 'revoked-post';
    const ack = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'should never land',
      idempotencyKey: key,
    });

    // The same 403 body REST's guard would produce, as an ack: forbidden,
    // and retrying it would never start working.
    expect(ack).toEqual({
      idempotencyKey: key,
      error: { code: 'FORBIDDEN', retryable: false },
    });
    await expect(rowsIn(seeded.alpha)).resolves.toBe(0);

    await sleep(300);
    expect(broadcasts).toHaveLength(0);
  });

  it('refuses a frame naming a channel the socket is not joined to', async () => {
    const seeded = await seed();
    const { ownerSocket } = await connectAll(seeded);

    // A channel created after the socket connected: the owner may post
    // there (owner short-circuit) but has no room for it yet — so this is a
    // subscription refusal, not an authorization failure.
    const late = idOf(
      (
        await seeded.owner.agent
          .post(`/servers/${seeded.serverId}/channels`)
          .send({ name: 'late', isPrivate: false })
      ).body,
    );

    const ack = await sendFrame(ownerSocket, {
      channelId: late,
      content: 'nobody is listening',
      idempotencyKey: 'unjoined-frame',
    });

    expect(ack).toEqual({
      idempotencyKey: 'unjoined-frame',
      error: { code: 'NOT_FOUND', retryable: false },
    });
    await expect(rowsIn(late)).resolves.toBe(0);
  });

  it('never delivers outside the room — a moderator with no seat in the private channel, nor a non-member', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, outsiderSocket, modSocket } =
      await connectAll(seeded);

    const modReceives = collectMessages(modSocket);
    const outsiderReceives = collectMessages(outsiderSocket);
    const memberReceives = collectMessages(memberSocket);

    const ownerSeated = requireSuccess(
      await sendFrame(ownerSocket, {
        channelId: seeded.secret,
        content: 'private chatter',
        idempotencyKey: 'private-send',
      }),
    );

    // The seated member gets it...
    await sleep(400);
    expect(memberReceives.map((message) => message.id)).toEqual([
      ownerSeated.messageId,
    ]);

    // ...the moderator, who is a moderator in this very server but holds no
    // ChannelMember row, does not; nor does the user in no server at all.
    expect(modReceives).toHaveLength(0);
    expect(outsiderReceives).toHaveLength(0);
  });

  it('answers the send past the message-send budget with rate_limited, retryable, and keeps the socket up', async () => {
    const seeded = await seed();
    const { memberSocket } = await connectAll(seeded);

    for (let index = 0; index < SEND_CAPACITY; index++) {
      const ack = await sendFrame(memberSocket, {
        channelId: seeded.alpha,
        content: `burst ${index}`,
        idempotencyKey: `burst-${index}`,
      });
      requireSuccess(ack);
    }

    const refused = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'one too many',
      idempotencyKey: 'over-budget',
    });

    // Rate-limited is the one retryable class: the budget refills, so a
    // later retry of this exact frame can succeed.
    expect(refused).toEqual({
      idempotencyKey: 'over-budget',
      error: { code: 'RATE_LIMITED', retryable: true },
    });

    // The frame is dropped, the connection is not (rate-limiter.md §6).
    expect(memberSocket.connected).toBe(true);
    await expect(rowsIn(seeded.alpha)).resolves.toBe(SEND_CAPACITY);
  });

  it("rejects content over the validator's cap with a non-retryable ack and writes nothing", async () => {
    const seeded = await seed();
    const { memberSocket } = await connectAll(seeded);

    const key = 'too-long';
    const ack = await sendFrame(memberSocket, {
      channelId: seeded.alpha,
      content: 'x'.repeat(2049),
      idempotencyKey: key,
    });

    expect(ack).toEqual({
      idempotencyKey: key,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    await expect(rowsIn(seeded.alpha)).resolves.toBe(0);
  });

  it('broadcasts a message posted over REST to sockets in the room', async () => {
    const seeded = await seed();
    const { ownerSocket } = await connectAll(seeded);

    const receives = nextMessage(ownerSocket);

    const posted = await seeded.member.agent
      .post(`/channels/${seeded.alpha}/messages`)
      .send({ content: 'typed into the REST route' });
    expect(posted.status).toBe(201);

    const received = await receives;
    expect(received).toEqual(posted.body as MessageResponse);
  });

  /**
   * AC-1: Real-time message delivery < 200ms (PRD §9).
   * Measures end-to-end latency from sender's ack to receiver's message_create.
   * Runs 10 iterations and asserts p95 < 200ms.
   */
  describe('AC-1: Real-time message delivery latency', () => {
    const ITERATIONS = 10;
    const LATENCY_THRESHOLD_MS = 200;

    it(`delivers messages in < ${LATENCY_THRESHOLD_MS}ms (p95 over ${ITERATIONS} runs)`, async () => {
      const seeded = await seed();
      const { ownerSocket, memberSocket } = await connectAll(seeded);
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const ownerReceives = nextMessage(ownerSocket);

        const ack = await sendFrame(memberSocket, {
          channelId: seeded.alpha,
          content: `latency test ${i}`,
          idempotencyKey: `latency-${i}`,
        });
        const ackTime = Date.now();

        requireSuccess(ack);

        await ownerReceives;
        const receiveTime = Date.now();

        const latency = receiveTime - ackTime;
        latencies.push(latency);

        // Reset rate limit budget between iterations to avoid hitting capacity
        await resetBudget('message-send');
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const p95Index = Math.ceil(ITERATIONS * 0.95) - 1;
      const p95 = sorted[p95Index];

      console.log(`Message delivery latencies (ms): ${latencies.join(', ')}`);
      console.log(
        `p50: ${sorted[Math.floor(ITERATIONS / 2)]}ms, p95: ${p95}ms, p99: ${sorted[ITERATIONS - 1]}ms`,
      );

      expect(p95).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });
});
