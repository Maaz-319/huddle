// Prisma CLI configuration. This is the one file that reads process.env
// directly: it configures the CLI, which runs outside the Nest application and
// so has no ConfigService to read from.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
