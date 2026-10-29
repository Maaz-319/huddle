import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import type { AuthenticatedSocket } from '../src/chat/chat.io-adapter';
import type { MessageResponse } from '../src/chat/message-response';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990700,
  login: 'octocat-revocation-owner',
  email: 'octocat-revocation-owner@example.com',
};

const MEMBER = {
  githubId: 990701,
  login: 'octocat-revocation-member',
  email: 'octocat-revocation-member@example.com',
};

const MOD = {
  githubId: 990702,
  login: 'octocat-revocation-mod',
  email: 'octocat-revocation-mod@example.com',
};

const FIXTURES = [OWNER, MEMBER, MOD];

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

/** What `channel_removed` and `channel_added` push — and nothing else. */
interface ChannelNotice {
  channelId: string;
}

describe('live access revocation and grants over the socket (e2e)', () => {
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

  /** Resolves with the next `event` this socket receives. */
  function nextEvent<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} within 5s`)),
        5_000,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** Starts counting `event` deliveries without waiting for one. */
  function collect<T>(socket: Socket, event: string): T[] {
    const received: T[] = [];
    socket.on(event, (payload: T) => {
      received.push(payload);
    });
    return received;
  }

  async function waitUntil(check: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (check()) return;
      await sleep(20);
    }
    throw new Error(`condition never held: ${label}`);
  }

  async function userIdOf(githubId: number): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(githubId) },
    });
    if (user === null) throw new Error(`No user for githubId ${githubId}`);
    return user.id;
  }

  function socketsOf(userId: bigint): AuthenticatedSocket[] {
    const owned: AuthenticatedSocket[] = [];
    for (const socket of gateway.server.sockets.sockets.values()) {
      if (socket.data.user.id === userId) owned.push(socket);
    }
    return owned;
  }

  /** Server-side room set across every connection the user holds. */
  function roomsOf(userId: bigint): Set<string> {
    const rooms = new Set<string>();
    for (const socket of socketsOf(userId)) {
      for (const room of socket.rooms) {
        if (room !== socket.id) rooms.add(room);
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

  async function postMessage(
    session: Session,
    channelId: string,
    content: string,
  ): Promise<void> {
    const response = await session.agent
      .post(`/channels/${channelId}/messages`)
      .send({ content });
    if (response.status !== 201) {
      throw new Error(`message post failed with ${response.status}`);
    }
  }

  interface Seeded {
    owner: Session;
    member: Session;
    mod: Session;
    serverId: string;
    alpha: string;
    secret: string;
  }

  /**
   * One server with a public channel (`alpha`) and a private one (`secret`),
   * mirroring the typing suite: the member is seated in `secret`, the
   * moderator — a moderator of the server — is not.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const mod = await logIn(MOD);

    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Revocation Suite' }))
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

    return { owner, member, mod, serverId, alpha, secret };
  }

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

    await waitForRooms(await userIdOf(OWNER.githubId), [
      seeded.alpha,
      seeded.secret,
    ]);
    await waitForRooms(await userIdOf(MEMBER.githubId), [
      seeded.alpha,
      seeded.secret,
    ]);
    await waitForRooms(await userIdOf(MOD.githubId), [seeded.alpha]);

    return { ownerSocket, memberSocket, modSocket };
  }

  it('notifies every connected member after a role change and ownership transfer', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);
    const notices = [ownerSocket, memberSocket, modSocket].map((socket) =>
      collect<{ serverId: string }>(socket, 'membership_changed'),
    );
    const memberId = await userIdOf(MEMBER.githubId);
    const promote = await seeded.owner.agent
      .patch(`/servers/${seeded.serverId}/members/${memberId}/role`)
      .send({ role: 'moderator' });
    expect(promote.status).toBe(200);
    await waitUntil(
      () => notices.every((items) => items.length === 1),
      'role notices',
    );
    expect(notices).toEqual(
      Array.from({ length: 3 }, () => [{ serverId: seeded.serverId }]),
    );

    await resetBudget('strict-mutation');
    const transfer = await seeded.owner.agent
      .post(`/servers/${seeded.serverId}/transfer-ownership`)
      .send({ toUserId: memberId });
    expect(transfer.status).toBe(204);
    await waitUntil(
      () => notices.every((items) => items.length === 2),
      'transfer notices',
    );
    expect(
      notices.every((items) => items[1].serverId === seeded.serverId),
    ).toBe(true);
  });

  it('notifies existing members and seats an already connected joiner', async () => {
    const owner = await logIn(OWNER);
    const joiner = await logIn(MEMBER);
    const outsider = await logIn(MOD);
    const serverId = idOf(
      (await owner.agent.post('/servers').send({ name: 'Join Notices' })).body,
    );
    await resetBudget('strict-mutation');
    const channelId = idOf(
      (
        await owner.agent
          .post(`/servers/${serverId}/channels`)
          .send({ name: 'lobby', isPrivate: false })
      ).body,
    );
    const invite = await owner.agent.get(`/servers/${serverId}/invite`);
    const code = (invite.body as { code: string }).code;
    const [ownerSocket, joinerSocket, outsiderSocket] = await Promise.all([
      connect(owner.cookie),
      connect(joiner.cookie),
      connect(outsider.cookie),
    ]);
    const ownerNotices = collect<{ serverId: string }>(
      ownerSocket,
      'membership_changed',
    );
    const joinerNotices = collect<{ serverId: string }>(
      joinerSocket,
      'membership_changed',
    );
    const outsiderNotices = collect<{ serverId: string }>(
      outsiderSocket,
      'membership_changed',
    );
    const joinedChannel = nextEvent<ChannelNotice>(
      joinerSocket,
      'channel_added',
    );
    await resetBudget('strict-mutation');
    const joined = await joiner.agent.post(`/invites/${code}/join`).send();
    expect(joined.status).toBe(200);
    expect(await joinedChannel).toEqual({ channelId });
    await waitUntil(
      () => ownerNotices.length === 1 && joinerNotices.length === 1,
      'join notices',
    );
    expect(ownerNotices).toEqual([{ serverId }]);
    expect(joinerNotices).toEqual([{ serverId }]);
    expect(outsiderNotices).toEqual([]);
  });

  it('removing a seat from a private channel: the channel disappears, silence there, the connection and the rest survive', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket } = await connectAll(seeded);

    const removed = nextEvent<ChannelNotice>(memberSocket, 'channel_removed');

    const response = await seeded.owner.agent
      .delete(
        `/channels/${seeded.secret}/members/${await userIdOf(MEMBER.githubId)}`,
      )
      .send();
    expect(response.status).toBe(204);

    expect(await removed).toEqual({ channelId: seeded.secret });

    // Server-side: the room is gone, not just the announcement.
    const memberId = await userIdOf(MEMBER.githubId);
    await waitUntil(
      () => !roomsOf(memberId).has(seeded.secret),
      'seat removed',
    );

    const seen = collect<MessageResponse>(memberSocket, 'message_create');
    await postMessage(seeded.owner, seeded.secret, 'you will not see this');
    await sleep(400);
    expect(
      seen.filter((message) => message.channelId === seeded.secret),
    ).toHaveLength(0);

    // The socket stays up and stays in the channels the user still has.
    const alphaMessage = nextEvent<MessageResponse>(
      memberSocket,
      'message_create',
    );
    await postMessage(seeded.owner, seeded.alpha, 'still here');
    expect((await alphaMessage).channelId).toBe(seeded.alpha);
    expect(memberSocket.connected).toBe(true);
    expect(roomsOf(memberId).has(seeded.alpha)).toBe(true);
    expect(ownerSocket.connected).toBe(true);
  });

  it('deleting a private channel removes it from every subscriber, and from nobody else', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);

    const memberRemoved = nextEvent<ChannelNotice>(
      memberSocket,
      'channel_removed',
    );
    const ownerRemoved = nextEvent<ChannelNotice>(
      ownerSocket,
      'channel_removed',
    );
    const modSeen = collect<ChannelNotice>(modSocket, 'channel_removed');

    const response = await seeded.owner.agent
      .delete(`/channels/${seeded.secret}`)
      .send();
    expect(response.status).toBe(204);

    expect(await memberRemoved).toEqual({ channelId: seeded.secret });
    expect(await ownerRemoved).toEqual({ channelId: seeded.secret });

    // The moderator was never in it: a revocation must not spray notices
    // at users whose access did not move.
    await sleep(300);
    expect(modSeen).toHaveLength(0);

    expect(memberSocket.connected).toBe(true);
    expect(ownerSocket.connected).toBe(true);
    expect(modSocket.connected).toBe(true);
  });

  it('a visibility flip moves a non-seated member live, and the seat survives the flip back', async () => {
    const seeded = await seed();

    // `lobby` starts private with only the moderator seated — a user with
    // no seat is the one whose access a flip actually moves.
    const lobbyResponse = await seeded.owner.agent
      .post(`/servers/${seeded.serverId}/channels`)
      .send({ name: 'lobby', isPrivate: true });
    const lobby = idOf(lobbyResponse.body);
    await resetBudget('strict-mutation');

    await prisma.channelMember.create({
      data: { channelId: BigInt(lobby), userId: await userIdOf(MOD.githubId) },
    });

    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);
    const modId = await userIdOf(MOD.githubId);
    await waitForRooms(ownerId, [lobby]);
    await waitForRooms(modId, [lobby]);
    expect(roomsOf(memberId).has(lobby)).toBe(false);

    // private → public: the non-seated member gains it in the same pass.
    const gained = nextEvent<ChannelNotice>(memberSocket, 'channel_added');
    const open = await seeded.owner.agent
      .patch(`/channels/${lobby}`)
      .send({ isPrivate: false });
    expect(open.status).toBe(200);
    expect(await gained).toEqual({ channelId: lobby });
    await waitUntil(
      () => roomsOf(memberId).has(lobby),
      'member joined the opened channel',
    );

    // public → private: the seat keeps the moderator, the missing seat
    // costs the member — both directions of one reconcile.
    const lost = nextEvent<ChannelNotice>(memberSocket, 'channel_removed');
    const close = await seeded.owner.agent
      .patch(`/channels/${lobby}`)
      .send({ isPrivate: true });
    expect(close.status).toBe(200);
    expect(await lost).toEqual({ channelId: lobby });

    expect(roomsOf(memberId).has(lobby)).toBe(false);
    expect(roomsOf(modId).has(lobby)).toBe(true);
    expect(roomsOf(ownerId).has(lobby)).toBe(true);
    expect(memberSocket.connected).toBe(true);
    expect(modSocket.connected).toBe(true);
    expect(ownerSocket.connected).toBe(true);
  });

  it('revoking a member-role override kicks the member out and lets the moderator through; restoring seats them back', async () => {
    const seeded = await seed();
    const { memberSocket, modSocket } = await connectAll(seeded);
    const memberId = await userIdOf(MEMBER.githubId);

    const lost = nextEvent<ChannelNotice>(memberSocket, 'channel_removed');
    const revoke = await seeded.owner.agent
      .put(`/channels/${seeded.alpha}/overrides/member/view`)
      .send({});
    expect(revoke.status).toBe(204);
    expect(await lost).toEqual({ channelId: seeded.alpha });
    expect(roomsOf(memberId).has(seeded.alpha)).toBe(false);

    // The moderator's capability is untouched by a member-role override:
    // the same channel, one socket served and one refused.
    const modHeard = nextEvent<MessageResponse>(modSocket, 'message_create');
    const seenByMember = collect<MessageResponse>(
      memberSocket,
      'message_create',
    );
    await postMessage(seeded.owner, seeded.alpha, 'moderator still here');
    expect((await modHeard).channelId).toBe(seeded.alpha);
    await sleep(300);
    expect(
      seenByMember.filter((message) => message.channelId === seeded.alpha),
    ).toHaveLength(0);

    const seatedBack = nextEvent<ChannelNotice>(memberSocket, 'channel_added');
    const restore = await seeded.owner.agent
      .delete(`/channels/${seeded.alpha}/overrides/member/view`)
      .send();
    expect(restore.status).toBe(204);
    expect(await seatedBack).toEqual({ channelId: seeded.alpha });
    await waitUntil(
      () => roomsOf(memberId).has(seeded.alpha),
      'member reseated after restore',
    );
    expect(modSocket.connected).toBe(true);
  });

  it('a demotion applies the member-role override that the moderator role was exempt from', async () => {
    const seeded = await seed();

    const revoke = await seeded.owner.agent
      .put(`/channels/${seeded.alpha}/overrides/member/view`)
      .send({});
    expect(revoke.status).toBe(204);
    await resetBudget('strict-mutation');

    // Not `connectAll`: the override is already in force, so the member
    // connects *without* alpha — the moderator, exempt from a member-role
    // override, still gets it. That asymmetry is the premise.
    const [ownerSocket, memberSocket, modSocket] = await Promise.all([
      connect(seeded.owner.cookie),
      connect(seeded.member.cookie),
      connect(seeded.mod.cookie),
    ]);
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);
    const modId = await userIdOf(MOD.githubId);
    await waitForRooms(ownerId, [seeded.alpha, seeded.secret]);
    await waitForRooms(memberId, [seeded.secret]);
    await waitForRooms(modId, [seeded.alpha]);
    expect(roomsOf(memberId).has(seeded.alpha)).toBe(false);
    expect(roomsOf(modId).has(seeded.alpha)).toBe(true);

    const demoted = nextEvent<ChannelNotice>(modSocket, 'channel_removed');
    const response = await seeded.owner.agent
      .patch(`/servers/${seeded.serverId}/members/${modId}/role`)
      .send({ role: 'member' });
    expect(response.status).toBe(200);

    expect(await demoted).toEqual({ channelId: seeded.alpha });
    expect(roomsOf(modId).has(seeded.alpha)).toBe(false);
    expect(modSocket.connected).toBe(true);

    // One write, one affected user: the other two are untouched — the
    // owner's bypass and the member's seat both still hold.
    expect(roomsOf(ownerId).has(seeded.alpha)).toBe(true);
    expect(roomsOf(memberId).has(seeded.secret)).toBe(true);
    expect(ownerSocket.connected).toBe(true);
    expect(memberSocket.connected).toBe(true);
  });

  it('deleting the server clears every room its members held, and keeps their connections', async () => {
    const seeded = await seed();
    const { ownerSocket, memberSocket, modSocket } = await connectAll(seeded);

    const memberSeen = collect<ChannelNotice>(memberSocket, 'channel_removed');
    const ownerSeen = collect<ChannelNotice>(ownerSocket, 'channel_removed');
    const modSeen = collect<ChannelNotice>(modSocket, 'channel_removed');

    const response = await seeded.owner.agent
      .delete(`/servers/${seeded.serverId}`)
      .send();
    expect(response.status).toBe(204);

    const memberId = await userIdOf(MEMBER.githubId);
    const modId = await userIdOf(MOD.githubId);
    await waitUntil(
      () => memberSeen.length >= 2 && ownerSeen.length >= 2,
      'both seated subscribers emptied',
    );

    // Whole rooms, one notice each — order is the reconcile's business,
    // not the contract's.
    expect(sorted(memberSeen.map((notice) => notice.channelId))).toEqual(
      sorted([seeded.alpha, seeded.secret]),
    );
    expect(sorted(ownerSeen.map((notice) => notice.channelId))).toEqual(
      sorted([seeded.alpha, seeded.secret]),
    );
    expect(modSeen.map((notice) => notice.channelId)).toEqual([seeded.alpha]);

    expect(roomsOf(memberId).size).toBe(0);
    expect(roomsOf(modId).size).toBe(0);
    expect(memberSocket.connected).toBe(true);
    expect(ownerSocket.connected).toBe(true);
    expect(modSocket.connected).toBe(true);
  });

  it('one revoke lands on every connection the user holds', async () => {
    const seeded = await seed();
    const { memberSocket } = await connectAll(seeded);

    const memberId = await userIdOf(MEMBER.githubId);
    const secondMemberSocket = await connect(seeded.member.cookie);
    await waitUntil(
      () =>
        socketsOf(memberId).length === 2 &&
        socketsOf(memberId).every((socket) => socket.rooms.has(seeded.secret)),
      'both member sockets seated',
    );

    const onFirst = nextEvent<ChannelNotice>(memberSocket, 'channel_removed');
    const onSecond = nextEvent<ChannelNotice>(
      secondMemberSocket,
      'channel_removed',
    );

    const response = await seeded.owner.agent
      .delete(`/channels/${seeded.secret}/members/${memberId.toString()}`)
      .send();
    expect(response.status).toBe(204);

    expect(await onFirst).toEqual({ channelId: seeded.secret });
    expect(await onSecond).toEqual({ channelId: seeded.secret });
    expect(memberSocket.connected).toBe(true);
    expect(secondMemberSocket.connected).toBe(true);
    expect(roomsOf(memberId).has(seeded.secret)).toBe(false);
  });

  it('seating someone into a private channel joins them live and the next message reaches them', async () => {
    const seeded = await seed();
    const { modSocket } = await connectAll(seeded);
    const modId = await userIdOf(MOD.githubId);
    expect(roomsOf(modId).has(seeded.secret)).toBe(false);

    const gained = nextEvent<ChannelNotice>(modSocket, 'channel_added');
    const response = await seeded.owner.agent
      .post(`/channels/${seeded.secret}/members`)
      .send({ userId: modId.toString() });
    expect(response.status).toBe(200);

    expect(await gained).toEqual({ channelId: seeded.secret });
    await waitUntil(
      () => roomsOf(modId).has(seeded.secret),
      'moderator seated live',
    );

    // The room join is real, not just the notice: the next broadcast
    // arrives on a channel the socket was not in a moment ago.
    const heard = nextEvent<MessageResponse>(modSocket, 'message_create');
    await postMessage(seeded.owner, seeded.secret, 'welcome aboard');
    expect((await heard).channelId).toBe(seeded.secret);
    expect(modSocket.connected).toBe(true);
  });
});
