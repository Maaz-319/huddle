import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as NetServer } from 'net';
import nock from 'nock';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { ChatIoAdapter } from '../src/chat/chat.io-adapter';
import { PresenceStore } from '../src/presence/presence-store.interface';
import { RedisPresenceStore } from '../src/presence/adapters/redis-presence-store.adapter';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

/** Response shape for GET /presence/snapshot */
interface PresenceSnapshotResponse {
  online: string[];
}

const OWNER = {
  githubId: 990900,
  login: 'octocat-presence-owner',
  email: 'octocat-presence-owner@example.com',
};

const MEMBER = {
  githubId: 990901,
  login: 'octocat-presence-member',
  email: 'octocat-presence-member@example.com',
};

const OUTSIDER = {
  githubId: 990902,
  login: 'octocat-presence-outsider',
  email: 'octocat-presence-outsider@example.com',
};

const FIXTURES = [OWNER, MEMBER, OUTSIDER];

/**
 * Shortened heartbeat window for e2e tests.
 * Default is 30s (10s interval + 20s timeout) + 5s buffer = 35s stale threshold.
 * This suite uses ~2s detection so tests don't wait 35s.
 */
const SHORT_HEARTBEAT_WINDOW_MS = 500;
const SHORT_STALE_THRESHOLD_MS = 1000;

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

type PresenceEvent = { userId: string };

describe('presence broadcast + snapshot (e2e)', () => {
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
    })
      .overrideProvider(PresenceStore)
      .useFactory({
        factory: (redisService: RedisService) =>
          new RedisPresenceStore(
            redisService,
            SHORT_HEARTBEAT_WINDOW_MS,
            SHORT_STALE_THRESHOLD_MS,
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

    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));
    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    const presenceKeys = await redis.keys('huddle:presence:*');
    if (presenceKeys.length > 0) await redis.del(...presenceKeys);

    nock.cleanAll();
  });

  async function resetBudget(policy: string): Promise<void> {
    const keys = await redis.keys(`huddle:rl:${policy}:*`);
    if (keys.length > 0) await redis.del(...keys);
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

  function collect<T>(socket: Socket, event: string): T[] {
    const received: T[] = [];
    socket.on(event, (payload: T) => {
      received.push(payload);
    });
    return received;
  }

  /** Wait for a user's presence to be registered (onConnect completed). */
  async function waitForPresenceRegistered(userId: bigint): Promise<void> {
    // Poll the online users set
    for (let attempt = 0; attempt < 50; attempt++) {
      const online = await redis.smembers('huddle:presence:online-users');
      if (online.includes(userId.toString())) return;
      await sleep(20);
    }
  }

  async function userIdOf(githubId: number): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(githubId) },
    });
    if (user === null) throw new Error(`No user for githubId ${githubId}`);
    return user.id;
  }

  async function waitUntil(
    check: () => boolean,
    label: string,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (check()) return;
      await sleep(20);
    }
    throw new Error(`condition never held: ${label}`);
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
      gamma: string;
    };
  }

  /**
   * Two servers, both with the owner as owner and the member seated.
   * Server A has public channels alpha, beta.
   * Server B has public channel gamma.
   * The outsider is in no server at all.
   */
  async function seed(): Promise<Seeded> {
    const owner = await logIn(OWNER);
    const member = await logIn(MEMBER);
    const outsider = await logIn(OUTSIDER);

    const serverA = idOf(
      (await owner.agent.post('/servers').send({ name: 'Presence A' })).body,
    );
    await resetBudget('strict-mutation');
    const serverB = idOf(
      (await owner.agent.post('/servers').send({ name: 'Presence B' })).body,
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
    const gamma = await createChannel(serverB, 'gamma', false);
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

    return {
      owner,
      member,
      outsider,
      serverA,
      serverB,
      channels: { alpha, beta, gamma },
    };
  }

  it('client A connects → client B receives presence_online for A (same server)', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);

    // Member connects first
    const memberSocket = await connect(seeded.member.cookie);
    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 1,
      'member socket connected',
    );

    const memberPresenceOnline = collect<PresenceEvent>(
      memberSocket,
      'presence_online',
    );
    const memberPresenceOffline = collect<PresenceEvent>(
      memberSocket,
      'presence_offline',
    );

    // Owner connects second — member should receive presence_online for owner
    await connect(seeded.owner.cookie);
    await waitUntil(
      () => memberPresenceOnline.length >= 1,
      'member receives presence_online for owner',
    );

    expect(memberPresenceOnline).toEqual([{ userId: ownerId.toString() }]);
    expect(memberPresenceOffline).toHaveLength(0);

    // Verify snapshot endpoint returns owner as online
    const snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual(
      expect.arrayContaining([ownerId.toString(), memberId.toString()]),
    );
  });

  it('clean disconnect: client A disconnects gracefully → client B receives presence_offline immediately', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);

    // Member connects first — sets up listeners
    const memberSocket = await connect(seeded.member.cookie);

    const memberPresenceOnline = collect<PresenceEvent>(
      memberSocket,
      'presence_online',
    );
    const memberPresenceOffline = collect<PresenceEvent>(
      memberSocket,
      'presence_offline',
    );

    // Owner connects second — member should receive presence_online
    const ownerSocket = await connect(seeded.owner.cookie);

    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 2,
      'both sockets connected',
    );

    // Wait for presence_online to ensure member is fully set up
    await waitUntil(
      () => memberPresenceOnline.length >= 1,
      'member receives presence_online for owner',
    );

    // Owner disconnects gracefully
    ownerSocket.disconnect();
    await waitUntil(
      () => memberPresenceOffline.length >= 1,
      'member receives presence_offline for owner',
    );

    expect(memberPresenceOffline).toEqual([{ userId: ownerId.toString() }]);

    // Snapshot should show owner offline, member online
    const snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual([
      memberId.toString(),
    ]);
  });

  it('dirty disconnect: client A drops (no close frame) → client B receives presence_offline after heartbeat timeout', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);

    // Member connects first — sets up listeners
    const memberSocket = await connect(seeded.member.cookie);

    const memberPresenceOnline = collect<PresenceEvent>(
      memberSocket,
      'presence_online',
    );
    const memberPresenceOffline = collect<PresenceEvent>(
      memberSocket,
      'presence_offline',
    );

    // Owner connects second — member should receive presence_online
    const ownerSocket = await connect(seeded.owner.cookie);

    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 2,
      'both sockets connected',
    );

    // Wait for presence_online to ensure member is fully set up
    await waitUntil(
      () => memberPresenceOnline.length >= 1,
      'member receives presence_online for owner',
    );

    // Simulate dirty disconnect: kill the socket without sending close frame
    // Close the underlying transport without the socket.io disconnect handshake
    ownerSocket.io.engine.close();

    // Should receive presence_offline after the short stale threshold (~1s)
    await waitUntil(
      () => memberPresenceOffline.length >= 1,
      'member receives presence_offline for owner after dirty disconnect',
      SHORT_STALE_THRESHOLD_MS + 2000,
    );

    expect(memberPresenceOffline).toEqual([{ userId: ownerId.toString() }]);

    // Snapshot should show owner offline, member online
    const snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual([
      memberId.toString(),
    ]);
  });

  it('multiple connections: client A opens two tabs, closes one → stays online; closes both → offline', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);

    // Member connects first — sets up listeners
    const memberSocket = await connect(seeded.member.cookie);

    const memberPresenceOnline = collect<PresenceEvent>(
      memberSocket,
      'presence_online',
    );
    const memberPresenceOffline = collect<PresenceEvent>(
      memberSocket,
      'presence_offline',
    );

    // Owner connects first tab — member should receive presence_online
    const ownerSocket1 = await connect(seeded.owner.cookie);

    // Wait for presence_online event
    await waitUntil(
      () => memberPresenceOnline.length >= 1,
      'member receives presence_online for owner',
    );

    expect(memberPresenceOnline).toEqual([{ userId: ownerId.toString() }]);
    expect(memberPresenceOffline).toHaveLength(0);

    // Owner opens second connection (second tab)
    const ownerSocket2 = await connect(seeded.owner.cookie);

    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 3,
      'three sockets connected',
    );

    // Give handleConnection time to complete and register presence
    await sleep(100);

    // Second connection should NOT trigger another presence_online
    expect(memberPresenceOnline).toEqual([{ userId: ownerId.toString() }]);
    expect(memberPresenceOffline).toHaveLength(0);

    // Close first tab
    ownerSocket1.disconnect();
    await sleep(200);

    // Owner should still be online (second connection active)
    // No new presence_offline event
    expect(memberPresenceOffline).toHaveLength(0);

    // Snapshot should still show owner online
    let snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual(
      expect.arrayContaining([ownerId.toString(), memberId.toString()]),
    );

    // Close second tab
    ownerSocket2.disconnect();
    await waitUntil(
      () => memberPresenceOffline.length >= 1,
      'member receives presence_offline after last connection closes',
    );

    expect(memberPresenceOffline).toEqual([{ userId: ownerId.toString() }]);

    // Snapshot should show owner offline
    snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual([
      memberId.toString(),
    ]);
  });

  it('snapshot endpoint: client connects, calls /presence/snapshot → gets correct initial online set', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);
    const memberId = await userIdOf(MEMBER.githubId);

    // Connect owner first
    await connect(seeded.owner.cookie);
    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 1,
      'owner socket connected',
    );
    await waitForPresenceRegistered(ownerId);

    // Member connects and immediately calls snapshot
    await connect(seeded.member.cookie);
    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 2,
      'both sockets connected',
    );
    await waitForPresenceRegistered(memberId);

    const snapshot = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: `${ownerId.toString()},${memberId.toString()}` })
      .set('Cookie', seeded.member.cookie);

    expect(snapshot.status).toBe(200);
    expect((snapshot.body as PresenceSnapshotResponse).online).toEqual(
      expect.arrayContaining([ownerId.toString(), memberId.toString()]),
    );

    // Requesting only owner should return only owner
    const snapshotOwnerOnly = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: ownerId.toString() })
      .set('Cookie', seeded.member.cookie);

    expect(snapshotOwnerOnly.status).toBe(200);
    expect((snapshotOwnerOnly.body as PresenceSnapshotResponse).online).toEqual(
      [ownerId.toString()],
    );

    // Requesting only outsider (not connected) should return empty
    const outsiderId = await userIdOf(OUTSIDER.githubId);
    const snapshotOutsider = await request(app.getHttpServer())
      .get('/presence/snapshot')
      .query({ userIds: outsiderId.toString() })
      .set('Cookie', seeded.member.cookie);

    expect(snapshotOutsider.status).toBe(200);
    expect((snapshotOutsider.body as PresenceSnapshotResponse).online).toEqual(
      [],
    );
  });

  it('global presence: user online in server A appears online to members of server B (no per-server presence)', async () => {
    const seeded = await seed();
    const ownerId = await userIdOf(OWNER.githubId);

    // Owner is in both serverA and serverB
    // Member is in both serverA and serverB

    // Member connects first — sets up listeners
    const memberSocket = await connect(seeded.member.cookie);

    const memberPresenceOnline = collect<PresenceEvent>(
      memberSocket,
      'presence_online',
    );

    // Owner connects (in both servers) — member should receive presence_online
    await connect(seeded.owner.cookie);

    await waitUntil(
      () => gateway.server.sockets.sockets.size >= 2,
      'both sockets connected',
    );

    // Member should receive presence_online for owner
    await waitUntil(
      () => memberPresenceOnline.length >= 1,
      'member receives presence_online for owner',
    );

    expect(memberPresenceOnline).toEqual([{ userId: ownerId.toString() }]);

    // The member shares both servers with owner, but presence is global
    // not per-server — one presence_online event, not two
    expect(memberPresenceOnline).toHaveLength(1);
  });
});
