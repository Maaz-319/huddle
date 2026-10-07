# Huddle

A simplified Discord. Users create servers, organise conversations into channels, chat
in real time, and see who is currently online. No voice, no video, no bots — just the
core of how a live community chat app works: a server that **pushes** updates the
instant something happens, and a permission system with real depth (server-level roles
plus per-channel overrides that can only tighten, never loosen).

## Documentation

The design is written down before it is built. Start with
[`docs/overview.md`](docs/overview.md) for the product and
[`docs/PRD.md`](docs/PRD.md) for the requirements; the component and stack decisions
live in [`docs/architecture/`](docs/architecture/), and the work is sequenced into 13
phases in [`docs/plans/CompletePlan.md`](docs/plans/CompletePlan.md).

Conventions for writing code in this repo are in [`AGENTS.md`](AGENTS.md).

## Layout

An npm workspaces monorepo:

- `apps/api` — the NestJS + socket.io backend. This is the whole project until Phase 12.
- `apps/web` — the React frontend. A placeholder package; deferred to Phase 12.

## Prerequisites

- **Node 24** (see [`.nvmrc`](.nvmrc); jest needs 24.9+ to load ESM-only dependencies such as `@nestjs/event-emitter`)
- **npm** 10 or newer, which ships with Node 24
- **Docker**, for the local Postgres and Redis

## Getting started

```
git clone https://github.com/Maaz-319/huddle.git
cd huddle
npm install
npm run db:up
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run dev
```

Run every command from the repo root — the workspaces resolve from there, and there is
a single `package-lock.json` at the root. Never run `npm install` inside `apps/*`.

`npm run dev` starts the API in watch mode. `GET /health` should answer `200`:

```
curl localhost:3000/health
{"status":"ok","info":{"app":{"status":"up"},"database":{"status":"up"}},...}
```

The `database` entry is a real query against Postgres, so stopping the container
turns this endpoint `503` rather than leaving it green.

## The Prisma client

This project is on **Prisma 7**, which differs from most guides online: it is Rust-free
and reaches Postgres through the `@prisma/adapter-pg` driver adapter, there is **no
`url` in the `datasource` block** (the connection string lives in
[`apps/api/prisma.config.ts`](apps/api/prisma.config.ts)), and the client is generated
into `apps/api/src/generated/prisma` rather than `node_modules`.

That folder is git-ignored and rebuilt by a `postinstall` script, so a fresh clone
compiles without a manual step. Import `PrismaClient` from there, never from
`@prisma/client`.

`PrismaService` ([`apps/api/src/common/prisma.service.ts`](apps/api/src/common/prisma.service.ts))
is the injectable wrapper and the only place the connection opens or closes. Only
`adapters/*.adapter.ts` files may inject it — never a `*.service.ts`.

## The database schema

All eight tables live in [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma),
authored in one pass and consumed — not grown — by later phases.
[`docs/architecture/data-model.md`](docs/architecture/data-model.md) is the authority for
what belongs in it.

| Script | What it does |
|---|---|
| `npm run db:migrate` | `prisma migrate dev` — apply and generate migrations |
| `npm run db:migrate:deploy` | `prisma migrate deploy` — apply only, for CI and deploys |
| `npm run db:studio` | Prisma Studio, a browser UI over the data |

Migrations are generated artifacts and are never hand-edited. Three things in the schema
look like omissions and are not:

- `User` and `Message` have no `createdAt` — it is decoded from the Snowflake ID.
- `ChannelOverride` has no value column — the row existing **is** the revocation.
- `Membership` carries `UNIQUE (serverId) WHERE role = 'owner'`, a partial unique index
  that enforces one owner per server in the database. It uses Prisma's `partialIndexes`
  preview feature, so ordinary `prisma migrate dev` keeps working.

## Configuration

Configuration lives in `apps/api/.env`, copied from
[`apps/api/.env.example`](apps/api/.env.example). `.env` is git-ignored and never
committed; `.env.example` is committed with defaults matching the Docker Compose
services below.

| Variable | Required | Default | What it is |
|---|---|---|---|
| `NODE_ENV` | no | `development` | One of `development`, `test`, `production` |
| `PORT` | no | `3000` | Port the API listens on |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `REDIS_URL` | **yes** | — | Redis connection string |
| `WEB_ORIGIN` | no | `http://localhost:5173` | Origin the browser client is served from |

Every variable is validated at startup against
[`apps/api/src/common/env.validation.ts`](apps/api/src/common/env.validation.ts).
A missing or malformed value **kills the process at boot**, naming the variable —
deliberately, so a misconfigured deploy fails immediately rather than at the first
request that needs the value. Adding a variable means adding it to that class and to
`.env.example` in the same commit.

## Local infrastructure

Postgres and Redis run in Docker, defined in [`docker-compose.yml`](docker-compose.yml).
Postgres keeps a named volume; Redis deliberately runs with persistence off, because
everything it holds in this project is ephemeral.

| Script | What it does |
|---|---|
| `npm run db:up` | Start Postgres and Redis in the background |
| `npm run db:down` | Stop both containers, keeping the Postgres volume |
| `npm run db:reset` | Tear down **including volumes** and come back up empty |

First boot creates two databases: `huddle` for development and `huddle_test` for the
integration tests, so a test run can never truncate your development data. That happens
via [`docker/init.sql`](docker/init.sql), which the Postgres image runs only when the
data volume is empty — so editing it later requires a `db:reset` to take effect.

> `db:reset` drops volumes. Only ever run it against local Docker.

## Continuous integration

Every pull request, and every push to `main`, runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) on GitHub Actions: `npm ci`,
then lint, typecheck, and unit tests.

CI runs no Postgres or Redis, so it runs neither the integration nor the end-to-end
tests — both need a real database. It does run `prisma validate`, which catches a
malformed schema without a server. Run the rest locally:
`npm run db:up && npm run test:integration && npm run test:e2e`.

| Script | What it does |
|---|---|
| `npm run lint` | ESLint with `--fix`, for local use |
| `npm run lint:ci` | The same rules without `--fix`, so a fixable violation fails the build |
| `npm run typecheck` | `tsc --noEmit` across the API |
| `npm test` | Unit tests. No Docker needed |
| `npm run test:integration` | Schema and adapter tests against `huddle_test`. Needs `npm run db:up` |
| `npm run test:e2e` | End-to-end tests. Needs `npm run db:up` |
