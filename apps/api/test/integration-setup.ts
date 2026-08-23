import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { TEST_DATABASE_URL } from './prisma-test-client';

/**
 * Jest globalSetup. Brings huddle_test up to the current migration history
 * before any spec runs, so `npm run test:integration` needs nothing but Docker.
 *
 * DATABASE_URL is overridden here rather than in .env: prisma.config.ts loads
 * dotenv, and dotenv does not overwrite a variable that is already set, so this
 * value wins.
 */
export default function globalSetup(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
