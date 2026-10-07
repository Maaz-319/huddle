import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import { TYPING_DEBOUNCE_MS } from '../src/chat/chat-state-store.interface';
import type { AckFailure } from '../src/chat/socket-frame';
import type { TypingBroadcast } from '../src/chat/typing.frame';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const OWNER = {
  githubId: 990500,
  login: 'octocat-typing-owner',
  email: 'octocat-typing-owner@example.com',
};

const MEMBER = {
  githubId: 990501,
  login: 'octocat-typing-member',
  email: 'octocat-typing-member@example.com',
};

const OUTSIDER = {
  githubId: 990502,
  login: 'octocat-typing-outsider',
  email: 'octocat-typing-outsider@example.com',
};

const MOD = {
  githubId: 990503,
  login: 'octocat-typing-mod',
  email: 'octocat-typing-mod@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER, MOD];

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

describe('typing indicators over the socket (e2e)', () => {
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
    await flushKeys('huddle:chat:typing:*');

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
        extraHeaders: { Cookie: cookie },
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

  /**
   * Fires a `typing` frame and hands back the collector its error ack lands
   * in. Success never calls the callback (#67's design), so an empty
   * collector after a wait is exactly the "no error frame" assertion.
   */
  function emitTyping(
    socket: Socket,
    frame: { channelId: string },
  ): AckFailure[] {
    const acks: AckFailure[] = [];
    socket.emit('typing', frame, (ack: AckFailure) => {
      acks.push(ack);
    });
    return acks;
  }

  /** Polls until an error ack arrives, or fails loudly after five seconds. */
  async function waitForAck(acks: AckFailure[]): Promise<AckFailure> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [first] = acks;
      if (first !== undefined) return first;
      await sleep(50);
    }
    throw new Error('no error ack for typing within 5s');
  }

  /** Resolves with the next `typing` event this socket receives. */
  function nextTyping(socket: Socket): Promise<TypingBroadcast> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no typing event within 5s')),
        5_000,
      );
      socket.once('typing', (event: TypingBroadcast) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  /** Starts counting `typing` deliveries without waiting for one. */
  function collectTyping(socket: Socket): TypingBroadcast[] {
    const received: TypingBroadcast[] = [];
    socket.on('typing', (event: TypingBroadcast) => {
      received.push(event);
    });
    return received;
  }

  /** The `tokens` field of a channel's typing bucket, as a float. */
  async function typingTokens(channelId: string): Promise<number> {
    const raw = await redis.hget(
      `huddle:rl:typing:channel:${channelId}`,
      'tokens',
    );
    if (raw === null) {
      throw new Error(
        'typing bucket missing — the debounce frame never reached the limiter',
      );
    }
    return Number.parseFloat(raw);
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
   * The member is seated in the private channel, the moderator — a
   * moderator in the server — is not, and the outsider is in no server at
   * all.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const outsider = await logIn(OUTSIDER);
    const mod = await logIn(MOD);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Typing Suite' })).body,
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

  it("delivers a typing event to the room with the sender's id — and never back to the sender", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const memberId = await userIdOf(MEMBER.githubId);
    const memberSeen = collectTyping(memberSocket);
    const ownerReceives = nextTyping(ownerSocket);

    emitTyping(memberSocket, { channelId: seeded.alpha });

    const received = await ownerReceives;
    expect(received).toEqual({
      channelId: seeded.alpha,
      userId: memberId.toString(),
    });

    // The sender is excluded from its own broadcast (`socket.to`, not
    // `io.to`): it already knows it is typing.
    await sleep(400);
    expect(memberSeen).toHaveLength(0);
  });

  it('ten typing frames inside three seconds produce exactly one broadcast', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const ownerSeen = collectTyping(ownerSocket);

    for (let index = 0; index < 10; index++) {
      emitTyping(memberSocket, { channelId: seeded.alpha });
    }

    // Counted on the receiving side, per the AC — not inferred from the
    // absence of errors.
    await sleep(600);
    expect(ownerSeen).toHaveLength(1);
  });

  it('broadcasts again once the debounce window has passed', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const ownerSeen = collectTyping(ownerSocket);

    emitTyping(memberSocket, { channelId: seeded.alpha });
    await sleep(400);
    emitTyping(memberSocket, { channelId: seeded.alpha });
    await sleep(400);
    expect(ownerSeen).toHaveLength(1);

    // Past the real window: the next frame opens a fresh one. This test
    // deliberately sleeps the full TYPING_DEBOUNCE_MS — the contract suite
    // shrinks the window to prove the mechanism; this proves the shipped
    // default is actually three seconds' worth.
    await sleep(TYPING_DEBOUNCE_MS + 500);
    emitTyping(memberSocket, { channelId: seeded.alpha });
    await sleep(500);

    expect(ownerSeen).toHaveLength(2);
  });

  it('debounces per channel: the same user broadcasts in two channels separately', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const memberId = await userIdOf(MEMBER.githubId);
    const ownerSeen = collectTyping(ownerSocket);

    emitTyping(memberSocket, { channelId: seeded.alpha });
    emitTyping(memberSocket, { channelId: seeded.secret });
    await sleep(500);

    expect(ownerSeen).toHaveLength(2);
    expect(sorted(ownerSeen.map((event) => event.channelId))).toEqual(
      sorted([seeded.alpha, seeded.secret]),
    );
    expect(
      ownerSeen.every((event) => event.userId === memberId.toString()),
    ).toBe(true);

    // Repeats in *both* channels are still inside their own windows: the
    // windows are (user, channel) pairs, not one per user.
    emitTyping(memberSocket, { channelId: seeded.alpha });
    emitTyping(memberSocket, { channelId: seeded.secret });
    await sleep(400);
    expect(ownerSeen).toHaveLength(2);
  });

  it('debounces per user: two people typing in one channel broadcast separately', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);
    const ownerSeen = collectTyping(ownerSocket);
    const memberSeen = collectTyping(memberSocket);

    emitTyping(memberSocket, { channelId: seeded.alpha });
    emitTyping(ownerSocket, { channelId: seeded.alpha });
    await sleep(500);

    expect(ownerSeen).toEqual([
      { channelId: seeded.alpha, userId: memberId.toString() },
    ]);
    expect(memberSeen).toEqual([
      { channelId: seeded.alpha, userId: ownerId.toString() },
    ]);
  });

  it('refuses a client without post — no broadcast, no error swallowed, socket stays up', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(seeded.alpha),
        role: 'member',
        capability: 'post',
      },
    });

    const ownerSeen = collectTyping(ownerSocket);
    const acks = emitTyping(memberSocket, { channelId: seeded.alpha });

    // The same refusal REST's guard would answer with, as an error ack —
    // someone who cannot write is not composing.
    expect(await waitForAck(acks)).toEqual({
      error: { code: 'FORBIDDEN', retryable: false },
    });

    await sleep(400);
    expect(ownerSeen).toHaveLength(0);
    expect(memberSocket.connected).toBe(true);
  });

  it('never delivers to someone outside the room — private channel, non-member, outsider', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, outsiderSocket, modSocket } =
      await connectAll(seeded);

    const ownerSeen = collectTyping(ownerSocket);
    const modSeen = collectTyping(modSocket);
    const outsiderSeen = collectTyping(outsiderSocket);

    // The moderator and the outsider cannot type into the private channel
    // either: hidden — the non-answer a channel outside their world gets.
    const modAcks = emitTyping(modSocket, { channelId: seeded.secret });
    const outsiderAcks = emitTyping(outsiderSocket, {
      channelId: seeded.secret,
    });
    expect(await waitForAck(modAcks)).toEqual({
      error: { code: 'NOT_FOUND', retryable: false },
    });
    expect(await waitForAck(outsiderAcks)).toEqual({
      error: { code: 'NOT_FOUND', retryable: false },
    });

    // And when the seated member does type there, only seated sockets hear
    // it: the moderator (a moderator of this very server, not seated) and
    // the user in no server at all receive nothing.
    emitTyping(memberSocket, { channelId: seeded.secret });
    await sleep(500);

    expect(ownerSeen).toEqual([
      {
        channelId: seeded.secret,
        userId: (await userIdOf(MEMBER.githubId)).toString(),
      },
    ]);
    expect(modSeen).toHaveLength(0);
    expect(outsiderSeen).toHaveLength(0);
  });

  it('drops a debounced frame silently: no error ack, no budget spent, no violation', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const ownerSeen = collectTyping(ownerSocket);
    const collectors: AckFailure[][] = [];

    for (let index = 0; index < 10; index++) {
      collectors.push(emitTyping(memberSocket, { channelId: seeded.alpha }));
    }

    await sleep(600);
    expect(ownerSeen).toHaveLength(1);

    // Every frame but the first was debounced — and none of them answered
    // with an error, nor counted as a rate-limit refusal: dropping is the
    // normal case while somebody types, not a violation.
    for (const acks of collectors) {
      expect(acks).toHaveLength(0);
    }

    // The bucket proves the other half: only the broadcast frame spent. A
    // limit-before-debounce ordering would have drained it to capacity minus
    // ten (+ refill) and still passed the assertions above.
    await expect(typingTokens(seeded.alpha)).resolves.toBeGreaterThanOrEqual(
      RATE_LIMIT_POLICIES.typing.capacity - 1,
    );
    expect(memberSocket.connected).toBe(true);
  });
});
