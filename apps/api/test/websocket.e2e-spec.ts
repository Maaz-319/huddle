import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const OWNER = {
  githubId: 990200,
  login: 'octocat-socket-owner',
  email: 'octocat-socket-owner@example.com',
};

const MEMBER = {
  githubId: 990201,
  login: 'octocat-socket-member',
  email: 'octocat-socket-member@example.com',
};

const OUTSIDER = {
  githubId: 990202,
  login: 'octocat-socket-outsider',
  email: 'octocat-socket-outsider@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER];

jest.setTimeout(20_000);

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

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A `connect_error` as socket.io-client delivers it — the server payload rides on `data`. */
type ConnectError = Error & { data?: { code?: string; retryAfter?: number } };

interface Session {
  agent: ReturnType<typeof request.agent>;
  /** The raw `Set-Cookie` value the OAuth callback issued, for handshake headers. */
  cookie: string;
}

describe('the WebSocket transport (e2e)', () => {
  // `net.Server` rather than supertest's wider `App` union: this spec reads
  // `address()` off the bound server to learn the port, and `App` includes
  // types that have no `address`.
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
    // either — deleting the servers cascades the channels, which cascades the
    // channel members, which leaves the user rows deletable.
    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));
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

  /** Opens a connection that must succeed. Refusals are the other helper's job. */
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

  /** A connection that must be refused, resolved with the `connect_error` the client saw. */
  function expectRefusal(cookie?: string): Promise<ConnectError> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, {
        ...(cookie === undefined ? {} : { extraHeaders: { Cookie: cookie } }),
        reconnection: false,
      });
      socket.once('connect_error', (error: Error) => {
        socket.close();
        resolve(error);
      });
      socket.once('connect', () => {
        socket.close();
        reject(new Error('connection unexpectedly succeeded'));
      });
    });
  }

  /** Channel rooms of every socket carrying this user, minus each socket's own id room. */
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

  function hasSocket(userId: bigint): boolean {
    for (const socket of gateway.server.sockets.sockets.values()) {
      if (socket.data.user.id === userId) return true;
    }
    return false;
  }

  async function userIdOf(githubId: number): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(githubId) },
    });
    if (user === null) throw new Error(`No user for githubId ${githubId}`);
    return user.id;
  }

  /**
   * Polls until the user's sockets hold exactly `expected`. Joins only ever
   * add rooms, so reaching the full expected set is terminal — no wait after
   * it can change the answer.
   */
  async function settleRooms(
    userId: bigint,
    expected: string[],
  ): Promise<void> {
    const want = sorted(expected);
    for (let attempt = 0; attempt < 150; attempt++) {
      const got = sorted(roomsOf(userId));
      if (
        got.length === want.length &&
        got.every((room, index) => room === want[index])
      ) {
        return;
      }
      await sleep(20);
    }
    throw new Error(
      `rooms never settled: want [${want.join(', ')}] got [${sorted(roomsOf(userId)).join(', ')}]`,
    );
  }

  interface Seeded {
    owner: Session;
    member: Session;
    outsider: Session;
    serverA: string;
    serverB: string;
    channels: {
      alpha: string;
      beta: string;
      secret: string;
      joined: string;
      gamma: string;
      vault: string;
    };
  }

  /**
   * Two servers, both with the owner as owner and the member seated. Server A
   * holds two public channels, a private one the member is not seated in, and
   * a private one they are; server B adds a public channel and a second
   * seated private one. The outsider is in no server at all.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const outsider = await logIn(OUTSIDER);

    const serverA = idOf(
      (await owner.agent.post('/servers').send({ name: 'Socket A' })).body,
    );
    await resetBudget('strict-mutation');
    const serverB = idOf(
      (await owner.agent.post('/servers').send({ name: 'Socket B' })).body,
    );
    await resetBudget('strict-mutation');

    const createChannel = async (
      serverId: string,
      name: string,
      isPrivate: boolean,
    ): Promise<string> => {
      const response = await owner.agent
        .post(`/servers/${serverId}/channels`)
        .send({ name, isPrivate });
      return idOf(response.body);
    };

    const alpha = await createChannel(serverA, 'alpha', false);
    const beta = await createChannel(serverA, 'beta', false);
    await resetBudget('strict-mutation');
    const secret = await createChannel(serverA, 'secret', true);
    const joined = await createChannel(serverA, 'joined', true);
    await resetBudget('strict-mutation');
    const gamma = await createChannel(serverB, 'gamma', false);
    const vault = await createChannel(serverB, 'vault', true);
    await resetBudget('strict-mutation');

    const memberUser = await prisma.user.findUnique({
      where: { githubId: String(MEMBER.githubId) },
    });
    if (memberUser === null) throw new Error('No user for the member fixture');
    await prisma.membership.createMany({
      data: [
        { serverId: BigInt(serverA), userId: memberUser.id, role: 'member' },
        { serverId: BigInt(serverB), userId: memberUser.id, role: 'member' },
      ],
    });
    await prisma.channelMember.createMany({
      data: [
        { channelId: BigInt(joined), userId: memberUser.id },
        { channelId: BigInt(vault), userId: memberUser.id },
      ],
    });

    return {
      owner,
      member,
      outsider,
      serverA,
      serverB,
      channels: { alpha, beta, secret, joined, gamma, vault },
    };
  }

  /** The union of what `GET /servers/:serverId/channels` returns for these servers. */
  async function listedChannels(
    agent: Session['agent'],
    serverIds: string[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const serverId of serverIds) {
      const response = await agent.get(`/servers/${serverId}/channels`);
      expect(response.status).toBe(200);
      const channels = response.body as { id: string }[];
      for (const channel of channels) ids.push(channel.id);
    }
    return ids;
  }

  describe('the handshake', () => {
    it('connects with a valid session cookie', async () => {
      const { cookie } = await logIn(OWNER);

      const socket = await connect(cookie);

      expect(socket.connected).toBe(true);
    });

    it('refuses a connection with no cookie', async () => {
      const error = await expectRefusal();

      expect(error.message).toBe('Not logged in');
    });

    it('refuses a cookie whose session was destroyed, exactly as REST does', async () => {
      const { agent, cookie } = await logIn(OUTSIDER);
      await agent.post('/auth/logout');

      const socketError = await expectRefusal(cookie);
      const rest = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie);

      expect(socketError.message).toBe('Not logged in');
      expect(rest.status).toBe(401);
      expect(errorOf(rest.body).message).toBe('Not logged in');
    });

    it('refuses a user deleted after login, exactly as REST does', async () => {
      const { cookie } = await logIn(MEMBER);
      await prisma.user.update({
        where: { githubId: String(MEMBER.githubId) },
        data: { deletedAt: new Date() },
      });

      const socketError = await expectRefusal(cookie);
      const rest = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie);

      expect(socketError.message).toBe('This account has been deleted');
      expect(rest.status).toBe(401);
      expect(errorOf(rest.body).message).toBe('This account has been deleted');
    });
  });

  describe('channel rooms', () => {
    let seeded: Seeded;

    beforeEach(async () => {
      seeded = await seed();
    });

    it('joins exactly the REST listing across all servers — two live clients at once', async () => {
      const ownerSocket = await connect(seeded.owner.cookie);
      const memberSocket = await connect(seeded.member.cookie);

      const ownerId = await userIdOf(OWNER.githubId);
      const memberId = await userIdOf(MEMBER.githubId);
      const allChannels = Object.values(seeded.channels);

      await settleRooms(ownerId, allChannels);
      await settleRooms(
        memberId,
        await listedChannels(seeded.member.agent, [
          seeded.serverA,
          seeded.serverB,
        ]),
      );

      expect(ownerSocket.connected).toBe(true);
      expect(memberSocket.connected).toBe(true);

      // The member's set is REST's answer, summed across servers: the private
      // channel they belong to is in, the private one they don't is out.
      expect(sorted(roomsOf(memberId))).toEqual(
        sorted([
          seeded.channels.alpha,
          seeded.channels.beta,
          seeded.channels.joined,
          seeded.channels.gamma,
          seeded.channels.vault,
        ]),
      );
      expect(roomsOf(memberId).has(seeded.channels.secret)).toBe(false);

      // The owner gets every channel in both servers — private ones too —
      // with no ChannelMember rows backing any of it.
      expect(sorted(roomsOf(ownerId))).toEqual(sorted(allChannels));
      expect(
        await prisma.channelMember.count({ where: { userId: ownerId } }),
      ).toBe(0);
    });

    it('joins no rooms at all for a user with no server memberships', async () => {
      await connect(seeded.outsider.cookie);

      const outsiderId = await userIdOf(OUTSIDER.githubId);
      for (let attempt = 0; !hasSocket(outsiderId); attempt++) {
        if (attempt >= 150) throw new Error('outsider socket never appeared');
        await sleep(20);
      }
      // The socket exists; give the join pass its moment to run, then prove
      // it found nothing to join.
      await sleep(100);

      expect(hasSocket(outsiderId)).toBe(true);
      expect(roomsOf(outsiderId).size).toBe(0);
    });
  });

  describe('the connection rate limit', () => {
    it('refuses the 6th attempt from one IP inside a minute, carrying retryAfter', async () => {
      const { cookie } = await logIn(OWNER);
      const capacity = RATE_LIMIT_POLICIES['ws-connect'].capacity;

      for (let attempt = 0; attempt < capacity; attempt++) {
        const socket = await connect(cookie);
        expect(socket.connected).toBe(true);
      }

      const error = await expectRefusal(cookie);

      expect(error.message).toBe('Too many connection attempts');
      expect(error.data?.code).toBe('RATE_LIMITED');
      expect(error.data?.retryAfter).toBeGreaterThan(0);
    });
  });
});
