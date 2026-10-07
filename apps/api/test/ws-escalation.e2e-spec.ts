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
import {
  ChatStateStore,
  SEND_RETENTION_MS,
  TYPING_DEBOUNCE_MS,
} from '../src/chat/chat-state-store.interface';
import type { CatchUpAck } from '../src/chat/catch-up.frame';
import type { DeleteAck } from '../src/chat/message-delete.frame';
import type { EditAck } from '../src/chat/message-edit.frame';
import type { MessageResponse } from '../src/chat/message-response';
import type { SendAck } from '../src/chat/message-send.frame';
import {
  POLICY_VIOLATION_EVENT,
  type PolicyViolation,
} from '../src/chat/socket-frame';
import type { TypingAck } from '../src/chat/typing.frame';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990800,
  login: 'octocat-escalation-owner',
  email: 'octocat-escalation-owner@example.com',
};

const MEMBER = {
  githubId: 990801,
  login: 'octocat-escalation-member',
  email: 'octocat-escalation-member@example.com',
};

const OUTSIDER = {
  githubId: 990802,
  login: 'octocat-escalation-outsider',
  email: 'octocat-escalation-outsider@example.com',
};

const MOD = {
  githubId: 990803,
  login: 'octocat-escalation-mod',
  email: 'octocat-escalation-mod@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER, MOD];

/**
 * The escalation window this suite runs with — a constructor argument, not a
 * different mechanism. The shipped default (60 seconds) is pinned two layers
 * down: the contract suite against both implementations, and the integration
 * spec's TTL assertion against real Redis. What only an end-to-end run can
 * prove is that the gateway notices the window passing and starts the count
 * over, so this suite shrinks the window the same way every other expiry
 * test in the repo does instead of sleeping a minute.
 */
const SHORT_VIOLATION_WINDOW_MS = 2_000;

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

type AnyAck = SendAck | EditAck | DeleteAck | CatchUpAck | TypingAck;

/** The refusal code an ack carries, or `null` when the frame succeeded. */
function refusalCode(ack: AnyAck): string | null {
  return 'error' in ack ? ack.error.code : null;
}

describe('escalation and abuse hardening over the socket (e2e)', () => {
  let app: INestApplication<NetServer>;
  let prisma: PrismaService;
  let redis: RedisService;
  let gateway: ChatGateway;
  let baseUrl: string;
  const openSockets: Socket[] = [];
  let keyCounter = 0;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ChatStateStore)
      .useFactory({
        factory: (redisService: RedisService) =>
          new RedisChatStateStore(
            redisService,
            SEND_RETENTION_MS,
            TYPING_DEBOUNCE_MS,
            SHORT_VIOLATION_WINDOW_MS,
          ),
        inject: [RedisService],
      })
      .compile();

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
    await flushKeys('huddle:chat:violations:*');

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

  /** Sends one frame and resolves with its single ack. */
  function ask<T>(socket: Socket, event: string, frame: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} ack within 5s`)),
        5_000,
      );
      socket.emit(event, frame, (ack: T) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  /** Fires one frame without waiting; its ack lands in `sink`, if it ever comes. */
  function emitInto<T>(
    socket: Socket,
    event: string,
    frame: unknown,
    sink: T[],
  ): void {
    socket.emit(event, frame, (ack: T) => {
      sink.push(ack);
    });
  }

  async function waitUntil(check: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (check()) return;
      await sleep(20);
    }
    throw new Error(`condition never held: ${label}`);
  }

  /** Starts counting `event` deliveries without waiting for one. */
  function collect<T>(socket: Socket, event: string): T[] {
    const received: T[] = [];
    socket.on(event, (payload: T) => {
      received.push(payload);
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

  /** The stored violation count for one user, `0` when no counter exists. */
  async function violationsOf(userId: bigint): Promise<number> {
    const raw = await redis.get(`huddle:chat:violations:${userId.toString()}`);
    return raw === null ? 0 : Number(raw);
  }

  /** Server-side room set of one specific connection, identified by its id. */
  function serverRooms(socket: Socket): Set<string> {
    const held = new Set<string>();
    const { id } = socket;
    if (id === undefined) return held;
    const serverSocket = gateway.server.sockets.sockets.get(id);
    if (serverSocket === undefined) return held;
    for (const room of serverSocket.rooms) {
      if (room !== serverSocket.id) held.add(room);
    }
    return held;
  }

  async function waitForRooms(
    socket: Socket,
    expected: string[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const held = serverRooms(socket);
      if (expected.every((room) => held.has(room))) return;
      await sleep(20);
    }
    throw new Error(
      `rooms never settled: wanted [${expected.join(', ')}] got [${sorted(serverRooms(socket)).join(', ')}]`,
    );
  }

  function nextKey(): string {
    keyCounter += 1;
    return `escalation-${keyCounter}`;
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
   * One server with a public channel (`alpha`) and a private one (`secret`),
   * mirroring the typing suite: the member is seated in `secret`, the
   * moderator — a moderator of the server — is not, and the outsider is in
   * no server at all.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const outsider = await logIn(OUTSIDER);
    const mod = await logIn(MOD);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Escalation Suite' }))
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

  /**
   * Sends `message_send` frames one at a time until `wanted` of them came
   * back `RATE_LIMITED`, and returns how many did. Counting the refusals
   * rather than indexing the frames is what absorbs the bucket's refill and
   * any earlier spends — the assertion is about refusals, so the loop is
   * too.
   */
  async function sendUntilRefused(
    socket: Socket,
    channelId: string,
    wanted: number,
  ): Promise<number> {
    let refusals = 0;
    let attempts = 0;
    while (refusals < wanted) {
      attempts += 1;
      if (attempts > 60) {
        throw new Error(
          `wanted ${wanted} rate refusals after ${attempts} attempts`,
        );
      }
      const ack = await ask<SendAck>(socket, 'message_send', {
        channelId,
        content: `frame ${attempts}`,
        idempotencyKey: nextKey(),
      });
      if (refusalCode(ack) === 'RATE_LIMITED') refusals += 1;
    }
    return refusals;
  }

  it('closes the offending connection at the fifth refusal — the user’s other connection stays, and reconnecting works', async () => {
    const seeded = await seed();
    const memberId = await userIdOf(MEMBER.githubId);

    const socketA = await connect(seeded.member.cookie);
    const socketB = await connect(seeded.member.cookie);
    await waitForRooms(socketA, [seeded.alpha, seeded.secret]);
    await waitForRooms(socketB, [seeded.alpha, seeded.secret]);

    const aNotices = collect<PolicyViolation>(socketA, POLICY_VIOLATION_EVENT);
    const bNotices = collect<PolicyViolation>(socketB, POLICY_VIOLATION_EVENT);

    const acks: SendAck[] = [];
    for (let index = 0; index < 12; index++) {
      emitInto<SendAck>(
        socketA,
        'message_send',
        {
          channelId: seeded.alpha,
          content: `flood ${index}`,
          idempotencyKey: nextKey(),
        },
        acks,
      );
    }

    await waitUntil(
      () =>
        acks.filter((ack) => refusalCode(ack) === 'RATE_LIMITED').length >= 5,
      'five rate refusals on the flooding socket',
    );
    await waitUntil(() => aNotices.length >= 1, 'the escalation notice');
    await sleep(400);

    // Exactly one notice — the first refusal at the limit schedules the
    // close; refusals that arrive inside the grace neither repeat the
    // notice nor postpone it.
    expect(aNotices).toEqual([
      { error: { code: 'TOO_MANY_VIOLATIONS', retryable: false } },
    ]);
    expect(socketA.connected).toBe(false);

    // Same user, second connection: the count is shared but the disconnect
    // is not. Socket B never heard a thing.
    expect(socketB.connected).toBe(true);
    expect(bNotices).toHaveLength(0);
    await expect(violationsOf(memberId)).resolves.toBeGreaterThanOrEqual(5);

    // And the user is not locked out: a fresh connection lands within the
    // ws-connect budget (this test has used three of five) with the full
    // room set, so the only thing escalation cost was the connection that
    // earned it.
    const socketC = await connect(seeded.member.cookie);
    expect(socketC.connected).toBe(true);
    await waitForRooms(socketC, [seeded.alpha, seeded.secret]);
  });

  it('counts refusals of different frame types toward one counter: sends then edits reach the limit together', async () => {
    const seeded = await seed();
    const socket = await connect(seeded.member.cookie);
    await waitForRooms(socket, [seeded.alpha, seeded.secret]);

    const notices = collect<PolicyViolation>(socket, POLICY_VIOLATION_EVENT);

    // The member's own message, so phase two's edits succeed on the way to
    // exhausting the budget rather than failing for another reason first.
    const seededMessage = await ask<SendAck>(socket, 'message_send', {
      channelId: seeded.alpha,
      content: 'about to be edited',
      idempotencyKey: nextKey(),
    });
    if ('error' in seededMessage) {
      throw new Error(`seed send refused: ${seededMessage.error.code}`);
    }
    const messageId = seededMessage.messageId;

    // Four message_send refusals: inside the limit, connection intact.
    await sendUntilRefused(socket, seeded.alpha, 4);
    expect(socket.connected).toBe(true);

    // The fifth refusal arrives on a message_edit instead — a different
    // frame, a different policy (strict-mutation is per user, message-send
    // per channel), the same counter. Three edits spend the user's bucket,
    // the fourth is refused.
    let refusals = 0;
    for (let attempt = 0; attempt < 10 && refusals < 1; attempt++) {
      const ack = await ask<EditAck>(socket, 'message_edit', {
        channelId: seeded.alpha,
        messageId,
        content: `edit ${attempt}`,
        idempotencyKey: nextKey(),
      });
      if (refusalCode(ack) === 'RATE_LIMITED') refusals += 1;
    }
    expect(refusals).toBe(1);

    await waitUntil(() => notices.length >= 1, 'the escalation notice');
    await sleep(400);
    expect(notices).toEqual([
      { error: { code: 'TOO_MANY_VIOLATIONS', retryable: false } },
    ]);
    expect(socket.connected).toBe(false);
    await expect(violationsOf(await userIdOf(MEMBER.githubId))).resolves.toBe(
      5,
    );
  });

  it('starts the count over once the window passes, and escalates again in the fresh one', async () => {
    const seeded = await seed();
    const socket = await connect(seeded.member.cookie);
    await waitForRooms(socket, [seeded.alpha, seeded.secret]);

    const notices = collect<PolicyViolation>(socket, POLICY_VIOLATION_EVENT);

    // Four refusals — one short of the limit.
    await sendUntilRefused(socket, seeded.alpha, 4);
    expect(socket.connected).toBe(true);

    // Past the window the *first* of those refusals opened. A counter that
    // never expired would be one refusal away from disconnecting; the
    // reset counter starts over, which the next assertion is about to
    // prove by almost trying to prove the opposite.
    await sleep(SHORT_VIOLATION_WINDOW_MS + 500);

    // One more refusal: still connected. Had the window failed to reset,
    // this would be refusal five and the socket would be closing by now
    // (the grace is 100ms; this waits four times that).
    await sendUntilRefused(socket, seeded.alpha, 1);
    await sleep(400);
    expect(socket.connected).toBe(true);
    expect(notices).toHaveLength(0);

    // Four more — five in the fresh window — and escalation works exactly
    // as it did before the reset.
    await sendUntilRefused(socket, seeded.alpha, 4);
    await waitUntil(() => notices.length >= 1, 'the escalation notice');
    await sleep(400);
    expect(notices).toEqual([
      { error: { code: 'TOO_MANY_VIOLATIONS', retryable: false } },
    ]);
    expect(socket.connected).toBe(false);
  });

  it('escalates a catch_up flood like every other frame — the read path hooks the same counter', async () => {
    const seeded = await seed();
    const socket = await connect(seeded.member.cookie);
    await waitForRooms(socket, [seeded.alpha, seeded.secret]);

    const notices = collect<PolicyViolation>(socket, POLICY_VIOLATION_EVENT);
    const acks: CatchUpAck[] = [];

    // The `read` budget is 60 per user, so a burst of 70 lands ten
    // refusals — five of which escalate, on a frame with no channel id of
    // its own and its own call site into limitFrame.
    for (let index = 0; index < 70; index++) {
      emitInto<CatchUpAck>(
        socket,
        'catch_up',
        {
          channels: [{ channelId: seeded.alpha, afterMessageId: '1' }],
        },
        acks,
      );
    }

    await waitUntil(
      () =>
        acks.filter((ack) => refusalCode(ack) === 'RATE_LIMITED').length >= 5,
      'five rate refusals on catch_up',
    );
    await waitUntil(() => notices.length >= 1, 'the escalation notice');
    await sleep(400);
    expect(notices).toEqual([
      { error: { code: 'TOO_MANY_VIOLATIONS', retryable: false } },
    ]);
    expect(socket.connected).toBe(false);
    const refused = acks.filter((ack) => refusalCode(ack) === 'RATE_LIMITED');
    expect(refused.length).toBeGreaterThanOrEqual(5);
    // No assertion about the allowed majority's acks: the refusals land
    // while those handlers are still querying, and their replies racing a
    // close scheduled 100ms out is the intended order, not a bug — the
    // normal success path of catch_up is catch-up.e2e-spec's to prove.
    expect(
      acks.every(
        (ack) =>
          refusalCode(ack) === null || refusalCode(ack) === 'RATE_LIMITED',
      ),
    ).toBe(true);
  });

  it('never counts a validation or permission refusal: only budget refusals reach the counter', async () => {
    const seeded = await seed();
    const memberSocket = await connect(seeded.member.cookie);
    const modSocket = await connect(seeded.mod.cookie);
    await waitForRooms(modSocket, [seeded.alpha]);
    await waitForRooms(memberSocket, [seeded.alpha, seeded.secret]);

    const memberId = await userIdOf(MEMBER.githubId);
    const modId = await userIdOf(MOD.githubId);

    // Eight malformed frames — every one refused by validation, before any
    // budget or counter is in scope.
    const garbage: SendAck[] = [];
    for (let index = 0; index < 8; index++) {
      const ack = await ask<SendAck>(memberSocket, 'message_send', {
        channelId: 'not-a-snowflake',
        content: 'x',
        idempotencyKey: nextKey(),
      });
      garbage.push(ack);
    }
    expect(
      garbage.every((ack) => refusalCode(ack) === 'VALIDATION_FAILED'),
    ).toBe(true);

    // Five permission refusals from the moderator against the private
    // channel — answers to the frame, not budget burns.
    for (let index = 0; index < 5; index++) {
      const ack = await ask<SendAck>(modSocket, 'message_send', {
        channelId: seeded.secret,
        content: `invisible ${index}`,
        idempotencyKey: nextKey(),
      });
      expect(refusalCode(ack)).toBe('NOT_FOUND');
    }

    // And one authorization refusal against a revoked post capability.
    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(seeded.alpha),
        role: 'member',
        capability: 'post',
      },
    });
    const forbidden = await ask<SendAck>(memberSocket, 'message_send', {
      channelId: seeded.alpha,
      content: 'revoked',
      idempotencyKey: nextKey(),
    });
    expect(refusalCode(forbidden)).toBe('FORBIDDEN');

    await sleep(400);
    expect(memberSocket.connected).toBe(true);
    expect(modSocket.connected).toBe(true);
    await expect(violationsOf(memberId)).resolves.toBe(0);
    await expect(violationsOf(modId)).resolves.toBe(0);
  });

  it('refuses every frame naming a channel the socket never joined — and the seated owner hears nothing from the attempt', async () => {
    const seeded = await seed();
    const { ownerSocket, modSocket } = {
      ownerSocket: await connect(seeded.owner.cookie),
      modSocket: await connect(seeded.mod.cookie),
    };
    await waitForRooms(ownerSocket, [seeded.alpha, seeded.secret]);
    await waitForRooms(modSocket, [seeded.alpha]);

    const ownerSeen = collect<MessageResponse>(ownerSocket, 'message_create');
    const ownerEdits = collect<MessageResponse>(ownerSocket, 'message_update');
    const ownerDeletes = collect<{ id: string; channelId: string }>(
      ownerSocket,
      'message_delete',
    );
    const ownerTyping = collect<{ channelId: string; userId: string }>(
      ownerSocket,
      'typing',
    );

    // The moderator holds `post` in this server but is not seated in
    // `secret`: hidden, so every mutating frame is a non-answer.
    const send = await ask<SendAck>(modSocket, 'message_send', {
      channelId: seeded.secret,
      content: 'hello?',
      idempotencyKey: nextKey(),
    });
    expect(refusalCode(send)).toBe('NOT_FOUND');

    const edit = await ask<EditAck>(modSocket, 'message_edit', {
      channelId: seeded.secret,
      messageId: '890123456789012399',
      content: 'edited nothing',
      idempotencyKey: nextKey(),
    });
    expect(refusalCode(edit)).toBe('NOT_FOUND');

    const remove = await ask<DeleteAck>(modSocket, 'message_delete', {
      channelId: seeded.secret,
      messageId: '890123456789012399',
      idempotencyKey: nextKey(),
    });
    expect(refusalCode(remove)).toBe('NOT_FOUND');

    const typingAcks: TypingAck[] = [];
    emitInto<TypingAck>(
      modSocket,
      'typing',
      { channelId: seeded.secret },
      typingAcks,
    );
    await waitUntil(() => typingAcks.length >= 1, 'the typing refusal');
    expect(typingAcks.map(refusalCode)).toEqual(['NOT_FOUND']);

    // catch_up is the one frame whose refusal to name a hidden channel is
    // an omission, not an error — an error would confirm existence to a
    // caller who can no longer see the channel (#68's oracle design). The
    // observable result is the same: no data, no acknowledgement of the
    // channel's existence.
    const catchUp = await ask<CatchUpAck>(modSocket, 'catch_up', {
      channels: [{ channelId: seeded.secret, afterMessageId: '1' }],
    });
    if ('error' in catchUp) {
      throw new Error(`catch_up erred: ${catchUp.error.code}`);
    }
    expect(catchUp.channels).toHaveLength(0);

    await sleep(400);
    expect(ownerSeen).toHaveLength(0);
    expect(ownerEdits).toHaveLength(0);
    expect(ownerDeletes).toHaveLength(0);
    expect(ownerTyping).toHaveLength(0);
    expect(modSocket.connected).toBe(true);
    // Refused, not rate-limited: hidden channels spend budget but never
    // count as abuse.
    await expect(violationsOf(await userIdOf(MOD.githubId))).resolves.toBe(0);
  });

  it('never lets a forged userId field override handshake attribution', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = {
      ownerSocket: await connect(seeded.owner.cookie),
      memberSocket: await connect(seeded.member.cookie),
    };
    await waitForRooms(ownerSocket, [seeded.alpha, seeded.secret]);
    await waitForRooms(memberSocket, [seeded.alpha, seeded.secret]);

    const memberId = await userIdOf(MEMBER.githubId);
    const ownerId = await userIdOf(OWNER.githubId);
    const ownerSeen = collect<MessageResponse>(ownerSocket, 'message_create');
    const ownerTyping = collect<{ channelId: string; userId: string }>(
      ownerSocket,
      'typing',
    );

    // The frame's whitelist is what rejects the forgery: an unknown field
    // is a validation failure, and the gateway only ever reads identity
    // from the handshake.
    const forgedKey = nextKey();
    const forgedSend = await ask<SendAck>(memberSocket, 'message_send', {
      channelId: seeded.alpha,
      content: 'impersonation attempt',
      idempotencyKey: forgedKey,
      userId: ownerId.toString(),
    });
    expect(refusalCode(forgedSend)).toBe('VALIDATION_FAILED');
    // The refusal still echoes the key, so the client can match it to the
    // bubble it never got to send.
    expect(
      'idempotencyKey' in forgedSend ? forgedSend.idempotencyKey : null,
    ).toBe(forgedKey);

    const typingAcks: TypingAck[] = [];
    emitInto<TypingAck>(
      memberSocket,
      'typing',
      { channelId: seeded.alpha, userId: ownerId.toString() },
      typingAcks,
    );
    await waitUntil(() => typingAcks.length >= 1, 'the forged typing refusal');
    expect(typingAcks.map(refusalCode)).toEqual(['VALIDATION_FAILED']);

    await sleep(300);
    expect(ownerSeen).toHaveLength(0);
    expect(ownerTyping).toHaveLength(0);

    // The honest frame that follows is attributed to the handshake — the
    // member, not the owner the forged one named.
    const honest = await ask<SendAck>(memberSocket, 'message_send', {
      channelId: seeded.alpha,
      content: 'the real me',
      idempotencyKey: nextKey(),
    });
    if ('error' in honest) {
      throw new Error(`honest send refused: ${honest.error.code}`);
    }
    await waitUntil(() => ownerSeen.length >= 1, 'the honest broadcast');
    expect(ownerSeen[0]?.authorId).toBe(memberId.toString());
  });

  it('keeps private-channel activity invisible to non-members across every event', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket, outsiderSocket } = {
      ownerSocket: await connect(seeded.owner.cookie),
      memberSocket: await connect(seeded.member.cookie),
      modSocket: await connect(seeded.mod.cookie),
      outsiderSocket: await connect(seeded.outsider.cookie),
    };
    await waitForRooms(ownerSocket, [seeded.alpha, seeded.secret]);
    await waitForRooms(memberSocket, [seeded.alpha, seeded.secret]);
    await waitForRooms(modSocket, [seeded.alpha]);

    const memberSeen = collect<MessageResponse>(memberSocket, 'message_create');
    const memberEdits = collect<MessageResponse>(
      memberSocket,
      'message_update',
    );
    const memberDeletes = collect<{ id: string }>(
      memberSocket,
      'message_delete',
    );
    // The typing broadcast goes to everyone *but* its sender, so the
    // seated listener for it is the owner — and the excluded sender is
    // exactly why member-side typing collectors would read nothing.
    const ownerTyping = collect<{ channelId: string; userId: string }>(
      ownerSocket,
      'typing',
    );
    const modSeen = collect<unknown>(modSocket, 'message_create');
    const modEdits = collect<unknown>(modSocket, 'message_update');
    const modDeletes = collect<unknown>(modSocket, 'message_delete');
    const modTyping = collect<unknown>(modSocket, 'typing');
    const outsiderSeen = collect<unknown>(outsiderSocket, 'message_create');
    const outsiderEdits = collect<unknown>(outsiderSocket, 'message_update');
    const outsiderDeletes = collect<unknown>(outsiderSocket, 'message_delete');
    const outsiderTyping = collect<unknown>(outsiderSocket, 'typing');

    // The full lifecycle inside the private channel, seated members only:
    // create, edit, delete, typing.
    const created = await ask<SendAck>(ownerSocket, 'message_send', {
      channelId: seeded.secret,
      content: 'a private thought',
      idempotencyKey: nextKey(),
    });
    if ('error' in created) {
      throw new Error(`secret send refused: ${created.error.code}`);
    }

    const edited = await ask<EditAck>(ownerSocket, 'message_edit', {
      channelId: seeded.secret,
      messageId: created.messageId,
      content: 'a revised private thought',
      idempotencyKey: nextKey(),
    });
    if ('error' in edited) {
      throw new Error(`secret edit refused: ${edited.error.code}`);
    }

    const removed = await ask<DeleteAck>(ownerSocket, 'message_delete', {
      channelId: seeded.secret,
      messageId: created.messageId,
      idempotencyKey: nextKey(),
    });
    if ('error' in removed) {
      throw new Error(`secret delete refused: ${removed.error.code}`);
    }

    const typingAcks: TypingAck[] = [];
    emitInto<TypingAck>(
      memberSocket,
      'typing',
      { channelId: seeded.secret },
      typingAcks,
    );
    await waitUntil(() => ownerTyping.length >= 1, 'the seated typing event');
    await sleep(300);

    // The seated member received all of it, the seated owner the typing —
    // the events exist, they simply never leave the room. A successful
    // typing frame acks nothing, so its collector stays silent on the
    // sender too.
    expect(memberSeen).toHaveLength(1);
    expect(memberEdits).toHaveLength(1);
    expect(memberDeletes).toHaveLength(1);
    expect(ownerTyping).toHaveLength(1);
    expect(typingAcks).toHaveLength(0);

    expect(modSeen).toHaveLength(0);
    expect(modEdits).toHaveLength(0);
    expect(modDeletes).toHaveLength(0);
    expect(modTyping).toHaveLength(0);
    expect(outsiderSeen).toHaveLength(0);
    expect(outsiderEdits).toHaveLength(0);
    expect(outsiderDeletes).toHaveLength(0);
    expect(outsiderTyping).toHaveLength(0);

    // catch_up silently omits what they cannot see: the outsider (in no
    // server) gets an empty reply naming neither channel; the moderator
    // gets `alpha` — the one they hold — and no trace of `secret`.
    const outsiderCatchUp = await ask<CatchUpAck>(outsiderSocket, 'catch_up', {
      channels: [
        { channelId: seeded.alpha, afterMessageId: '1' },
        { channelId: seeded.secret, afterMessageId: '1' },
      ],
    });
    if ('error' in outsiderCatchUp) {
      throw new Error(`outsider catch_up erred: ${outsiderCatchUp.error.code}`);
    }
    expect(outsiderCatchUp.channels).toHaveLength(0);

    const modCatchUp = await ask<CatchUpAck>(modSocket, 'catch_up', {
      channels: [
        { channelId: seeded.alpha, afterMessageId: '1' },
        { channelId: seeded.secret, afterMessageId: '1' },
      ],
    });
    if ('error' in modCatchUp) {
      throw new Error(`mod catch_up erred: ${modCatchUp.error.code}`);
    }
    expect(modCatchUp.channels.map((entry) => entry.channelId)).toEqual([
      seeded.alpha,
    ]);
  });

  it('gives no frame a path to server, channel, override or membership state', async () => {
    const seeded = await seed();
    const memberSocket = await connect(seeded.member.cookie);
    await waitForRooms(memberSocket, [seeded.alpha, seeded.secret]);

    const snapshot = async () => {
      const channel = await prisma.channel.findUnique({
        where: { id: BigInt(seeded.alpha) },
        select: { name: true, isPrivate: true },
      });
      const server = await prisma.server.findUnique({
        where: { id: BigInt(seeded.serverId) },
        select: { name: true },
      });
      const membership = await prisma.membership.findUnique({
        where: {
          serverId_userId: {
            serverId: BigInt(seeded.serverId),
            userId: await userIdOf(MEMBER.githubId),
          },
        },
        select: { role: true },
      });
      const overrides = await prisma.channelOverride.count({
        where: { channelId: BigInt(seeded.alpha) },
      });
      return { channel, server, membership, overrides };
    };

    const before = await snapshot();
    expect(before).toEqual({
      channel: { name: 'alpha', isPrivate: false },
      server: { name: 'Escalation Suite' },
      membership: { role: 'member' },
      overrides: 0,
    });

    // A complete, *successful* pass through every frame the protocol
    // offers a member — send, edit and delete their own message, typing,
    // catch_up. No `manage_settings` frame exists to invoke: administration
    // writes ride REST behind the RBAC guards (#57–#59), and this
    // enumeration is the structural half of that claim — there is no
    // fourth, seventh or tenth frame hiding past these five.
    const sent = await ask<SendAck>(memberSocket, 'message_send', {
      channelId: seeded.alpha,
      content: 'and then I tried everything',
      idempotencyKey: nextKey(),
    });
    if ('error' in sent) throw new Error(`send: ${sent.error.code}`);

    const edited = await ask<EditAck>(memberSocket, 'message_edit', {
      channelId: seeded.alpha,
      messageId: sent.messageId,
      content: 'and then I tried everything, twice',
      idempotencyKey: nextKey(),
    });
    if ('error' in edited) throw new Error(`edit: ${edited.error.code}`);

    const removed = await ask<DeleteAck>(memberSocket, 'message_delete', {
      channelId: seeded.alpha,
      messageId: sent.messageId,
      idempotencyKey: nextKey(),
    });
    if ('error' in removed) throw new Error(`delete: ${removed.error.code}`);

    const typingAcks: TypingAck[] = [];
    emitInto<TypingAck>(
      memberSocket,
      'typing',
      { channelId: seeded.alpha },
      typingAcks,
    );
    await sleep(300);

    const catchUp = await ask<CatchUpAck>(memberSocket, 'catch_up', {
      channels: [{ channelId: seeded.alpha, afterMessageId: '1' }],
    });
    if ('error' in catchUp) throw new Error(`catch_up: ${catchUp.error.code}`);

    expect(typingAcks).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
  });
});
