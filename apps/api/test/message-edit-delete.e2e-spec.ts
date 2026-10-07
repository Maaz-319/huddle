import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import type { DeleteAck } from '../src/chat/message-delete.frame';
import type { EditAck } from '../src/chat/message-edit.frame';
import type {
  MessageDeleteResponse,
  MessageResponse,
} from '../src/chat/message-response';
import type { SendAck } from '../src/chat/message-send.frame';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const OWNER = {
  githubId: 990400,
  login: 'octocat-edit-owner',
  email: 'octocat-edit-owner@example.com',
};

const MEMBER = {
  githubId: 990401,
  login: 'octocat-edit-member',
  email: 'octocat-edit-member@example.com',
};

const MOD = {
  githubId: 990403,
  login: 'octocat-edit-mod',
  email: 'octocat-edit-mod@example.com',
};

const FIXTURES = [OWNER, MEMBER, MOD];

/** The burst `strict-mutation` absorbs before the bucket is empty. */
const MUTATION_CAPACITY = RATE_LIMIT_POLICIES['strict-mutation'].capacity;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

describe('editing and deleting messages over the socket (e2e)', () => {
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
    await flushKeys('huddle:chat:edit:*');
    await flushKeys('huddle:chat:delete:*');

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

  /** Emits one frame and resolves with the sender's direct ack. */
  function emitWithAck<Ack>(
    event: 'message_send' | 'message_edit' | 'message_delete',
    socket: Socket,
    frame: Record<string, unknown>,
  ): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ack for ${event} within 5s`)),
        5_000,
      );
      socket.emit(event, frame, (ack: Ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  function sendFrame(
    socket: Socket,
    frame: { channelId: string; content: string; idempotencyKey: string },
  ): Promise<SendAck> {
    return emitWithAck<SendAck>('message_send', socket, frame);
  }

  function editFrame(
    socket: Socket,
    frame: {
      channelId: string;
      messageId: string;
      content: string;
      idempotencyKey: string;
    },
  ): Promise<EditAck> {
    return emitWithAck<EditAck>('message_edit', socket, frame);
  }

  function deleteFrame(
    socket: Socket,
    frame: {
      channelId: string;
      messageId: string;
      idempotencyKey: string;
    },
  ): Promise<DeleteAck> {
    return emitWithAck<DeleteAck>('message_delete', socket, frame);
  }

  /** Resolves with the next `message_update` this socket receives. */
  function nextUpdate(socket: Socket): Promise<MessageResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no message_update within 5s')),
        5_000,
      );
      socket.once('message_update', (message: MessageResponse) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  /** Resolves with the next `message_delete` this socket receives. */
  function nextDelete(socket: Socket): Promise<MessageDeleteResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no message_delete within 5s')),
        5_000,
      );
      socket.once('message_delete', (deletion: MessageDeleteResponse) => {
        clearTimeout(timer);
        resolve(deletion);
      });
    });
  }

  /** Starts counting `message_update` deliveries without waiting for one. */
  function collectUpdates(socket: Socket): MessageResponse[] {
    const received: MessageResponse[] = [];
    socket.on('message_update', (message: MessageResponse) => {
      received.push(message);
    });
    return received;
  }

  /** Starts counting `message_delete` deliveries without waiting for one. */
  function collectDeletes(socket: Socket): MessageDeleteResponse[] {
    const received: MessageDeleteResponse[] = [];
    socket.on('message_delete', (deletion: MessageDeleteResponse) => {
      received.push(deletion);
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
    mod: Session;
    serverId: string;
    alpha: string;
  }

  /**
   * One server with a single public channel. The member holds the `member`
   * role and the moderator — a moderator in the same server — neither needs
   * a channel seat for it. No private channel or outsider: none of #66's
   * acceptance criteria involve them.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const mod = await logIn(MOD);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Edit Suite' })).body,
    );
    await resetBudget('strict-mutation');

    const alpha = idOf(
      (
        await owner.agent
          .post(`/servers/${serverId}/channels`)
          .send({ name: 'alpha', isPrivate: false })
      ).body,
    );
    await resetBudget('strict-mutation');

    const memberUser = await userIdOf(MEMBER.githubId);
    const modUser = await userIdOf(MOD.githubId);
    await prisma.membership.createMany({
      data: [
        { serverId: BigInt(serverId), userId: memberUser, role: 'member' },
        { serverId: BigInt(serverId), userId: modUser, role: 'moderator' },
      ],
    });

    return { owner, member, mod, serverId, alpha };
  }

  /** Connects the three sessions and waits until their rooms are as seeded. */
  async function connectAll(seeded: Seeded): Promise<{
    ownerSocket: Socket;
    memberSocket: Socket;
    modSocket: Socket;
  }> {
    const [ownerSocket, memberSocket, modSocket] = await Promise.all([
      connect(seeded.owner.cookie),
      connect(seeded.member.cookie),
      connect(seeded.mod.cookie),
    ]);

    await waitForRooms(await userIdOf(OWNER.githubId), [seeded.alpha]);
    await waitForRooms(await userIdOf(MEMBER.githubId), [seeded.alpha]);
    await waitForRooms(await userIdOf(MOD.githubId), [seeded.alpha]);

    return { ownerSocket, memberSocket, modSocket };
  }

  let fixtureCounter = 0;

  /** Posts a message over the socket and returns what the ack carried. */
  async function createMessage(
    socket: Socket,
    channelId: string,
    content: string,
  ): Promise<SendAckSuccessLike> {
    const ack = await sendFrame(socket, {
      channelId,
      content,
      idempotencyKey: `fixture-${fixtureCounter++}`,
    });

    if (!('messageId' in ack)) {
      throw new Error(`fixture send failed: ${JSON.stringify(ack)}`);
    }
    return ack;
  }

  interface SendAckSuccessLike {
    idempotencyKey: string;
    messageId: string;
    createdAt: string;
  }

  interface EditAckSuccessLike {
    idempotencyKey: string;
    messageId: string;
    editedAt: string | null;
  }

  interface DeleteAckSuccessLike {
    idempotencyKey: string;
    messageId: string;
  }

  /** The success half of an `EditAck`, or a loud failure if it was an error. */
  function requireEditSuccess(ack: EditAck): EditAckSuccessLike {
    if (!('messageId' in ack)) {
      throw new Error(`expected a success ack, got ${JSON.stringify(ack)}`);
    }
    return ack;
  }

  /** The success half of a `DeleteAck`, or a loud failure if it was an error. */
  function requireDeleteSuccess(ack: DeleteAck): DeleteAckSuccessLike {
    if (!('messageId' in ack)) {
      throw new Error(`expected a success ack, got ${JSON.stringify(ack)}`);
    }
    return ack;
  }

  async function rowOf(messageId: string): Promise<{
    content: string;
    editedAt: Date | null;
    isDeleted: boolean;
  }> {
    const row = await prisma.message.findUnique({
      where: { id: BigInt(messageId) },
    });
    if (row === null) throw new Error(`no message row for ${messageId}`);
    return row;
  }

  it("edits one client's message so the other sees message_update with the new content and editedAt", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);
    const memberId = await userIdOf(MEMBER.githubId);

    const original = await createMessage(
      memberSocket,
      seeded.alpha,
      'original',
    );

    // Listener first: the ack is written before the broadcast, so the
    // promise exists before anything can be emitted.
    const ownerReceives = nextUpdate(ownerSocket);

    const ack = await editFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: original.messageId,
      content: '  corrected text  ',
      idempotencyKey: 'edit-broadcast',
    });

    // The sender's direct ack: its key, the message it changed, and the
    // stamp that renders the "(edited)" marker — content is trimmed exactly
    // as REST's body would trim it.
    const success = requireEditSuccess(ack);
    expect(success.idempotencyKey).toBe('edit-broadcast');
    expect(success.messageId).toBe(original.messageId);
    expect(success.editedAt).toMatch(ISO);

    // The other client receives the full updated message.
    const ownerView = await ownerReceives;
    expect(ownerView).toEqual({
      id: original.messageId,
      channelId: seeded.alpha,
      authorId: memberId.toString(),
      content: 'corrected text',
      createdAt: original.createdAt,
      editedAt: success.editedAt,
      isDeleted: false,
    });

    // And it is a real update in the database, not just an echo.
    const row = await rowOf(original.messageId);
    expect(row.content).toBe('corrected text');
    expect(row.editedAt).not.toBeNull();
  });

  it("deletes one client's message so the other sees message_delete, with the content nowhere in the frame", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const doomed = await createMessage(
      memberSocket,
      seeded.alpha,
      'top secret content',
    );

    const ownerReceives = nextDelete(ownerSocket);

    const ack = await deleteFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: doomed.messageId,
      idempotencyKey: 'delete-broadcast',
    });

    const success = requireDeleteSuccess(ack);
    expect(success.idempotencyKey).toBe('delete-broadcast');
    expect(success.messageId).toBe(doomed.messageId);

    // Exactly the id and the channel — the placeholder a client renders
    // needs nothing else, and the deleted text must appear nowhere.
    const ownerView = await ownerReceives;
    expect(ownerView).toEqual({
      id: doomed.messageId,
      channelId: seeded.alpha,
    });
    expect(JSON.stringify(ownerView)).not.toContain('top secret content');

    // The row is soft-deleted and its text genuinely gone (#63 blanks the
    // stored value; this asserts the broadcast was built after that write).
    const row = await rowOf(doomed.messageId);
    expect(row.isDeleted).toBe(true);
    expect(row.content).toBe('');
  });

  it('broadcasts message_update and message_delete when the change arrives over REST instead of the socket', async () => {
    const seeded = await seed();
    const { ownerSocket } = await connectAll(seeded);

    const posted = await seeded.member.agent
      .post(`/channels/${seeded.alpha}/messages`)
      .send({ content: 'typed into the REST route' });
    expect(posted.status).toBe(201);
    const messageId = idOf(posted.body);

    // The case that is easy to forget: REST's PATCH and DELETE emit through
    // the very same trio the socket handlers use.
    const updateReceived = nextUpdate(ownerSocket);
    const patched = await seeded.member.agent
      .patch(`/channels/${seeded.alpha}/messages/${messageId}`)
      .send({ content: 'edited over REST' });
    expect(patched.status).toBe(200);
    expect(await updateReceived).toEqual(patched.body as MessageResponse);

    const deleteReceived = nextDelete(ownerSocket);
    const removed = await seeded.member.agent.delete(
      `/channels/${seeded.alpha}/messages/${messageId}`,
    );
    expect(removed.status).toBe(204);
    expect(await deleteReceived).toEqual({
      id: messageId,
      channelId: seeded.alpha,
    });
  });

  it("refuses a non-author's edit with an error frame and produces no broadcast", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);

    const owned = await createMessage(
      memberSocket,
      seeded.alpha,
      'member words',
    );

    const broadcasts = collectUpdates(ownerSocket);

    const ack = await editFrame(modSocket, {
      channelId: seeded.alpha,
      messageId: owned.messageId,
      content: 'moderator tampering',
      idempotencyKey: 'non-author-edit',
    });

    // Author-only, the rule #62 wrote — the service refuses it over the
    // socket exactly as it refuses REST's PATCH.
    expect(ack).toEqual({
      idempotencyKey: 'non-author-edit',
      error: { code: 'FORBIDDEN', retryable: false },
    });

    const row = await rowOf(owned.messageId);
    expect(row.content).toBe('member words');
    expect(row.editedAt).toBeNull();

    await sleep(300);
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses a member deleting someone else's message, and lets a moderator delete one", async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);

    const memberMessage = await createMessage(
      memberSocket,
      seeded.alpha,
      'written by the member',
    );
    const modMessage = await createMessage(
      modSocket,
      seeded.alpha,
      'written by the moderator',
    );

    const updates = collectUpdates(ownerSocket);
    const deletes = collectDeletes(ownerSocket);

    // A plain member holds `post` but not `delete_others` — the two-step
    // check #63 wrote runs inside the service, unchanged.
    const refused = await deleteFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: modMessage.messageId,
      idempotencyKey: 'member-deletes-others',
    });
    expect(refused).toEqual({
      idempotencyKey: 'member-deletes-others',
      error: { code: 'FORBIDDEN', retryable: false },
    });

    // A moderator does hold `delete_others` and succeeds.
    const ack = await deleteFrame(modSocket, {
      channelId: seeded.alpha,
      messageId: memberMessage.messageId,
      idempotencyKey: 'moderator-deletes',
    });
    const success = requireDeleteSuccess(ack);
    expect(success.messageId).toBe(memberMessage.messageId);

    await sleep(300);
    expect(deletes).toEqual([
      { id: memberMessage.messageId, channelId: seeded.alpha },
    ]);
    expect(updates).toHaveLength(0);

    // The refused delete left its row alone; the moderator's went through.
    expect((await rowOf(modMessage.messageId)).isDeleted).toBe(false);
    expect((await rowOf(memberMessage.messageId)).isDeleted).toBe(true);
  });

  it('dedupes repeated edit and delete keys inside the window: identical acks, no second mutation, one broadcast each', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const message = await createMessage(
      memberSocket,
      seeded.alpha,
      'before the replay',
    );

    const updates = collectUpdates(ownerSocket);
    const deletes = collectDeletes(ownerSocket);

    const first = await editFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: message.messageId,
      content: 'edited once',
      idempotencyKey: 'replay-edit',
    });
    // Same key, different content: the replay must return the original ack
    // and leave the first edit standing — it never reaches the service.
    const second = await editFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: message.messageId,
      content: 'a totally different second try',
      idempotencyKey: 'replay-edit',
    });
    expect(second).toEqual(first);
    expect((await rowOf(message.messageId)).content).toBe('edited once');

    // The member has now spent two of the three `strict-mutation` tokens;
    // hand the bucket back so the delete half is not measured against it.
    await resetBudget('strict-mutation');

    const firstDelete = await deleteFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: message.messageId,
      idempotencyKey: 'replay-delete',
    });
    const secondDelete = await deleteFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: message.messageId,
      idempotencyKey: 'replay-delete',
    });
    expect(secondDelete).toEqual(firstDelete);
    expect(requireDeleteSuccess(firstDelete).messageId).toBe(message.messageId);

    await sleep(300);
    expect(updates).toHaveLength(1);
    expect(deletes).toHaveLength(1);
    expect((await rowOf(message.messageId)).isDeleted).toBe(true);
  });

  it('answers an edit past the strict-mutation budget with rate_limited, retryable, and keeps the socket up', async () => {
    const seeded = await seed();
    const { memberSocket } = await connectAll(seeded);

    const message = await createMessage(
      memberSocket,
      seeded.alpha,
      'edit me until the bucket empties',
    );

    for (let index = 0; index < MUTATION_CAPACITY; index++) {
      const ack = await editFrame(memberSocket, {
        channelId: seeded.alpha,
        messageId: message.messageId,
        content: `burst edit ${index}`,
        idempotencyKey: `burst-${index}`,
      });
      requireEditSuccess(ack);
    }

    const refused = await editFrame(memberSocket, {
      channelId: seeded.alpha,
      messageId: message.messageId,
      content: 'one edit too many',
      idempotencyKey: 'over-budget',
    });

    // Rate-limited is the one retryable class: the bucket refills, so a
    // later retry of this exact frame can succeed.
    expect(refused).toEqual({
      idempotencyKey: 'over-budget',
      error: { code: 'RATE_LIMITED', retryable: true },
    });

    // The frame is dropped, the connection is not (rate-limiter.md §6).
    expect(memberSocket.connected).toBe(true);
    expect((await rowOf(message.messageId)).content).toBe(
      `burst edit ${MUTATION_CAPACITY - 1}`,
    );
  });

  it('refuses an edit frame naming a channel the socket is not joined to', async () => {
    const seeded = await seed();
    const { ownerSocket } = await connectAll(seeded);

    // A channel created after the socket connected: the owner may edit
    // there (owner short-circuit) but has no room for it yet — so this is a
    // subscription refusal, not an authorization failure.
    const late = idOf(
      (
        await seeded.owner.agent
          .post(`/servers/${seeded.serverId}/channels`)
          .send({ name: 'late', isPrivate: false })
      ).body,
    );

    const ack = await editFrame(ownerSocket, {
      channelId: late,
      messageId: '890123456789012345',
      content: 'nobody can see this channel yet',
      idempotencyKey: 'unjoined-edit',
    });

    expect(ack).toEqual({
      idempotencyKey: 'unjoined-edit',
      error: { code: 'NOT_FOUND', retryable: false },
    });
  });
});
