import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaUserRepository } from '../src/auth/adapters/prisma-user-repository.adapter';
import { UserRepository } from '../src/auth/user-repository.interface';
import { PrismaService } from '../src/common/prisma.service';
import { SnowflakeService } from '../src/common/snowflake.service';
import { describeUserRepositoryContract } from './fakes/user-repository.contract';
import { TEST_DATABASE_URL, truncateAll } from './prisma-test-client';

/**
 * The reference adapter against the real Docker Postgres.
 *
 * The bulk of this file is one line: the same contract the fake is held to,
 * run against the adapter. Without it the fake is a false sense of safety —
 * it would prove the port is usable, not that Postgres actually behaves that
 * way (docs/architecture/repo-structure.md section 6).
 *
 * The cases below the contract are the ones a `Map` cannot express.
 */
describe('PrismaUserRepository', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let users: UserRepository;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        SnowflakeService,
        // The real DATABASE_URL is never consulted: these cases TRUNCATE, so
        // they must be incapable of reaching the development database.
        { provide: ConfigService, useValue: { get: () => TEST_DATABASE_URL } },
        { provide: UserRepository, useClass: PrismaUserRepository },
      ],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    users = module.get(UserRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port token to the Prisma adapter', () => {
    // The `{ provide: UserRepository, useClass: PrismaUserRepository }` binding
    // in auth.module.ts is the whole pattern; this asserts an abstract class
    // really does work as a DI token, which a TS interface would not.
    expect(users).toBeInstanceOf(PrismaUserRepository);
  });

  describeUserRepositoryContract('PrismaUserRepository', async () => {
    await truncateAll(prisma);
    return users;
  });

  describe('behaviour that needs a real database', () => {
    const PROFILE = {
      githubId: '583231',
      username: 'octocat',
      avatarUrl: 'https://example.test/octocat.png',
      email: 'octocat@example.test',
    };

    beforeEach(async () => {
      await truncateAll(prisma);
    });

    it('reads back a full 64-bit id without losing precision', async () => {
      // Seeded rather than minted: HUDDLE_EPOCH is only days old, so a
      // Snowflake generated today still fits in a double and would prove
      // nothing here. This one is from late in the epoch's range and does not
      // -- the assertion below says so, and is what the BigInt column exists
      // for. Ids stop fitting in a double roughly 25 days after the epoch.
      const LATE_SNOWFLAKE = 8000000000000000123n;
      expect(BigInt(Number(LATE_SNOWFLAKE))).not.toBe(LATE_SNOWFLAKE);

      await prisma.user.create({ data: { id: LATE_SNOWFLAKE, ...PROFILE } });

      await expect(users.findById(LATE_SNOWFLAKE)).resolves.toMatchObject({
        id: LATE_SNOWFLAKE,
      });
    });

    it('mints ids as bigint, never as a number', async () => {
      const created = await users.create(PROFILE);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
      });

      expect(typeof row.id).toBe('bigint');
      expect(row.id).toBe(created.id);
    });

    it('stores the email GitHub gave us', async () => {
      const created = await users.create(PROFILE);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
      });

      expect(row.email).toBe(PROFILE.email);
    });

    it('leaves a bio the user wrote alone when GitHub re-syncs', async () => {
      const created = await users.create(PROFILE);
      await prisma.user.update({
        where: { id: created.id },
        data: { bio: 'Building things.' },
      });

      const updated = await users.updateProfile(created.id, {
        username: 'monalisa',
        avatarUrl: 'https://example.test/monalisa.png',
        email: 'monalisa@example.test',
      });

      expect(updated.bio).toBe('Building things.');
      expect(updated.username).toBe('monalisa');
    });
  });
});
