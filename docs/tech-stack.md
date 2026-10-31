# Tech stack

| Technology | What Huddle uses it for |
|---|---|
| TypeScript and npm workspaces | One repository for API, web app, and shared contracts. |
| NestJS | Backend modules, controllers, dependency injection, validation, and guards. |
| React and Vite | Browser application and local development server. |
| TanStack Router | Web page and URL routing. |
| Zustand | Shared web application state. |
| Socket.IO | Persistent connection for messages, presence, typing, and access notices. |
| PostgreSQL | Durable application data. |
| Prisma 7 with `@prisma/adapter-pg` | Schema, migrations, typed database access, and Postgres driver adapter. |
| Redis with ioredis | Sessions, token buckets, presence, typing debounce, and short-lived retry state. |
| GitHub OAuth with Passport | User sign-in and profile lookup. |
| `class-validator` and `class-transformer` | Validate and transform HTTP and socket inputs. |
| Jest and Vitest | API and web tests. |

The backend and frontend share HTTP and socket wire types from `packages/contracts`. Run `npm run typecheck`, `npm run lint:ci`, `npm test`, and `npm run test:web` from the repository root for the primary checks.
