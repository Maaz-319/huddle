import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * The database the integration tests target, hardcoded to `huddle_test` rather
 * than derived from DATABASE_URL. These tests TRUNCATE between cases, so a
 * mistyped environment variable must not be able to point them at the
 * development database. docker/init.sql creates this database on first boot.
 *
 * Reading process.env directly is correct here: this is test infrastructure
 * running outside the Nest application, with no ConfigService in scope, for the
 * same reason prisma.config.ts does it. It deliberately does NOT go in
 * EnvironmentVariables -- a test-only variable there would become required at
 * application boot.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://huddle:huddle@localhost:5432/huddle_test';

export function createTestClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
}

// Child tables first, though CASCADE makes the order cosmetic. Listed
// explicitly rather than read from the catalog so that a new table added
// without a thought about test isolation shows up as a diff here.
const TABLES = [
  'Message',
  'ChannelOverride',
  'ChannelMember',
  'Invite',
  'Channel',
  'Membership',
  'Server',
  'User',
] as const;

/**
 * Empties every table. Called between cases so the suite passes when run twice
 * in a row -- see AGENTS.md section 5.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
