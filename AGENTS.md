Conventions for anyone writing code in this repo. Read this before you touch anything.
Where a rule points at a doc, read the doc, this file does not repeat what `docs/` already explains.

---

## 1. What this repo is

**Huddle** — a simplified Discord. Users create servers, organise conversations into channels, chat in real time, and see who is online. No voice, no video, no bots. Read [docs/overview.md](docs/overview.md) for the product, [docs/PRD.md](docs/PRD.md) for the requirements.

It is a portfolio/learning project, and the point of it is the two hard parts: **the server pushing information to clients the instant something happens**, and **a permission system with real depth** (server-level roles, plus per-channel overrides that can only tighten, never loosen).

An npm workspaces monorepo:

- **`apps/api`** — NestJS + socket.io backend. This is the whole project until Phase 12.
- **`apps/web`** — React frontend. **Deferred to Phase 12**; a placeholder package only. Do not build features here.

The stack is already locked, with the reasoning recorded. Do not re-litigate a choice without reading why it was made: [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md).

Three of those decisions are deliberate *rejections* of the obvious library, and are easy to undo by accident:

- **No CASL.** RBAC is two hand-built decorators on Nest's own `SetMetadata`/`Reflector` — `@RequireRole(...)` and `@RequireCapability(...)`. See [tech-stack.md §6](docs/architecture/tech-stack.md).
- **No `@nestjs/throttler`.** Rate limiting is a custom token bucket in Redis + Lua, because throttler is a time-window counter and cannot express burst-then-refill, and because it only covers REST. See [docs/architecture/rate-limiter.md](docs/architecture/rate-limiter.md).
- **No PKCE.** Passport's stock Authorization Code flow with `state: true`. See [docs/architecture/auth-service.md](docs/architecture/auth-service.md).

Work is sequenced in 13 phases in [docs/plans/CompletePlan.md](docs/plans/CompletePlan.md). Each phase is a GitHub milestone; each ticket is an issue. Build in phase order — a later phase assumes the earlier ones landed.

---

## 2. Where new files go

Read [docs/architecture/repo-structure.md](docs/architecture/repo-structure.md) before adding a file. The rules here are a summary of that doc.

`apps/api/src/` has one folder per Nest module — `auth/`, `administration/`, `chat/`, `presence/`, `rate-limiter/` — plus `common/` for code more than one of them uses. **Do not add layered subfolders** (`services/`, `controllers/`, `dto/`). Files sit flat in the service folder and are distinguished by filename suffix, matching Nest's own convention. The one subfolder is `adapters/`.

**The port/adapter rule, which is the whole point of the layout:**

- **`*.interface.ts`** is the port. It is an **abstract class, never a TypeScript `interface`** — Nest binds DI against a runtime token, and a TS interface is erased at compile time. Getting this wrong fails at runtime, not at compile time.
- **`adapters/*.adapter.ts`** is the only place a third-party client may be imported — `PrismaClient`, `ioredis`, `passport-github2`.
- **`*.service.ts`** holds business logic and depends only on ports. **A `*.service.ts` must never inject `PrismaService` or `RedisService`, and never import a third-party client.** If you find yourself wanting to, the port is missing a method — add it there.
- **`*.controller.ts` / `*.gateway.ts`** are thin: validate the DTO, call the service, shape the response.
- Wire it in the module with `{ provide: SomePort, useClass: SomeAdapter }`.

**socket.io is the documented exception** — it is not wrapped behind a port. It is the transport the Chat, Presence, and Rate Limiter modules are built around, not an interchangeable backing store. See [repo-structure.md §4](docs/architecture/repo-structure.md).

`apps/api/src/common/` holds the Snowflake generator, shared DTOs and error types, `PrismaService`, and `RedisService`.

---

## 4. TypeScript

**Never write `as never`.** Not in tests, not in source, not "just to get this compiling." It does not adapt a value to a type — it switches off checking at that call site entirely. They are why a real schema will mismatch: the tests become green because they had stopped looking.

The rule underneath it: **a type error is information about your data. Fix the data, not the error.**

Also banned, for the same reason: `any`, `@ts-ignore`, `@ts-expect-error` without an explanation, and `as unknown as T`.

The one legitimate escape is a genuinely untyped third-party boundary. When you need one, put the reason on the line above it:

If you cannot write that comment honestly, you do not have the exception.

### IDs are `bigint`, and they leave as strings

Every ID in this system is a **Snowflake**: 64-bit, stored as `BigInt` in Postgres, handled as `bigint` in TypeScript. A JS `number` cannot hold one — it will silently lose precision rather than throw.

On the wire they are **JSON strings, in both directions**. `JSON.stringify` on a raw `bigint` throws a `TypeError` at runtime, so `BigInt.prototype.toJSON` is patched globally in `main.ts`. Inbound IDs arrive as strings and are parsed by `ParseSnowflakePipe` (route params) or `@IsSnowflake()` / `@TransformSnowflake()` (DTO fields). Use them; do not hand-roll a parse.

`HUDDLE_EPOCH` is a fixed constant. **It must never change once IDs exist in any database** — every ID's timestamp is decoded relative to it, and `User` and `Message` have no `createdAt` column precisely because it is decoded from the ID.

---

## 5. Tests

- **Test Must not be just passing because of `as Never` usage**
- **A test that would still pass with the function deleted is not a test.** Assert on the thing that changed, not on the absence of a throw.
- Every repository function gets a test. Every schema boundary gets a test proving a wrong shape is *rejected*, not just that a right one is accepted.
- Run them with `npm test`. They must pass before you open a PR.

**Every port gets both kinds of test.** This is the convention, not a suggestion — see [repo-structure.md §6](docs/architecture/repo-structure.md):

1. A **fake**, in-memory and `Map`-backed, implementing the same abstract class. Service unit tests run against the fake — fast, no Docker, and it proves the port is actually sufficient for the logic depending on it.
2. An **integration test for the real adapter**, hitting real Docker Postgres or Redis. Without it the fakes are a false sense of safety: they prove the service works, not that the adapter satisfies the contract.

`npm test` runs the unit tests and must not need Docker. `npm run test:integration` needs it. CI runs both.

Integration tests use the separate **`huddle_test`** database, never the dev database, and truncate between tests. Running the suite twice in a row must pass both times.

Testing is **focused, not exhaustive** ([tech-stack.md §10](docs/architecture/tech-stack.md)). The things genuinely worth the effort: RBAC guard resolution including tighten-only overrides, the token-bucket primitive, and the real-time flows in PRD §9 (two-client delivery, presence flip on disconnect, typing indicator, a tampered client blocked server-side).

---

## 8. Database and migrations

Read [docs/architecture/data-model.md](docs/architecture/data-model.md) before touching the database. The rules here are a summary of that doc.
- **Migrations are generated. Never hand-edit one.**
  The one recorded exception is the partial unique index `UNIQUE (serverId) WHERE role = 'owner'`, if Prisma's `partialIndexes` preview feature turns out to be unavailable. If you take that fallback, it must be recorded in `data-model.md` §7, because every later migration then has to be produced with `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ... --script` or the index gets diffed away.
- **Never hand-merge or hand-edit `package-lock.json`.** On a conflict: delete it, reinstall, commit the fresh one. Lockfiles are generated artifacts; a person merging one produces a tree that resolves on nobody's machine.

**This is Prisma 7**, which is a real departure from almost every tutorial online:

- There is **no `url` in the `datasource` block**. Connection config lives in `apps/api/prisma.config.ts`.
- It is Rust-free and needs the **`@prisma/adapter-pg` driver adapter**.
- The client is generated into **`apps/api/src/generated/prisma`**, not `node_modules`. Import `PrismaClient` from there, **not from `@prisma/client`**. That folder is git-ignored and regenerated on install.

The schema is authored once, in full, in Phase 1 — all eight tables. Later phases consume it rather than growing it. Things that look like bugs but are deliberate, and are explained in `data-model.md`:

- `User` and `Message` have **no `createdAt`**. It is decoded from the Snowflake. `Server`, `Channel`, and `Invite` do have one.
- `ChannelOverride` has **no value column**. The row existing *is* the revocation.
- Overrides can only **tighten**, never grant. An override role is `moderator` or `member` only — owner is never overridable.

Everything Redis holds — sessions, rate-limit buckets, presence, idempotency keys — is **intentionally ephemeral**. Local Redis runs with persistence off on purpose. Never make correctness depend on a Redis key surviving a restart.

---

## 9. Secrets and runtime config

- **Config is read through `ConfigService`, never `process.env` directly.** `ConfigModule` is registered globally.
- **Every variable is validated at boot** by a `class-validator`-decorated `EnvironmentVariables` class, and a failure **throws**. A misconfigured deploy must die at startup, not at first request. If you add a variable, add it to that class and to `.env.example` in the same commit.
- `.env.example` is committed with local-Docker defaults. **`.env` is git-ignored and never committed.**
- Do not add a variable before the phase that uses it — validation would reject an otherwise-working checkout. The GitHub OAuth and session variables land in Phase 3, not before.
- Never hardcode a URL scheme. Redis Cloud requires TLS, so production is `rediss://` while local is `redis://` — always build the client from the configured URL.

---

## 10. Git and pull requests

- **Branch naming: `<issue-number>-<short-slug>`** — e.g. `4-config-validation`. No type prefix; the issue carries that context already.
- **Keep changes under roughly 400 lines.** A change too big to review carefully gets reviewed carelessly instead.
- **One issue at a time.** Branch off the latest `main`, several small logically-scoped commits, and `Closes #<n>` in the PR body.
- **No AI or assistant attribution** in commit messages, PR titles, PR bodies, or docs.
- **Do not commit or push unless asked.**
- `gh issue view` and `gh pr edit` are broken in this repo (a GraphQL failure). Use `gh api` against the REST endpoints instead.

---

## 11. Commands

All commands run **from the repo root** — they delegate into the workspace. Never `npm install` from inside `apps/api`; it breaks workspace resolution.

| Command | What it does |
|---|---|
| `npm install` | Install everything. One lockfile, at the root. |
| `npm run db:up` / `db:down` | Start / stop the Docker Postgres and Redis. |
| `npm run db:reset` | Tear down **including volumes** and come back up empty. |
| `npm run db:migrate` | `prisma migrate dev` — apply and generate migrations. |
| `npm run dev` | Start the API in watch mode. |
| `npm test` | Unit tests. Must pass without Docker running. |
| `npm run test:integration` | Adapter tests against real Docker Postgres and Redis. |
| `npm run test:e2e` | End-to-end tests. |
| `npm run lint` / `npm run typecheck` / `npm run build` | Must all pass before a PR. |

Run a single test file or case with Jest's own flags, e.g. `npm test -- user-repository` or `npm test -- -t "rejects a second owner"`.

First-time setup on a fresh clone:

```
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev          # GET /health should report app + postgres + redis up
```

CI runs lint, typecheck, unit, and e2e against service containers on every pull request.

### Never run

- **`npm run db:reset` against anything but local Docker.** It drops volumes.
- **`prisma migrate reset`**, and any `prisma db push` — it skips the migration history, which is the thing that has to be reproducible.
- **`docker compose down -v`** casually. Same reason as `db:reset`.
- **`npm install` inside `apps/api`.** Use `-w @huddle/api` from the root.
- Any `git push --force` to `main`.

> Never Edit This file without giving human 2 popups, never directly edit it, always stop and ask a human to review it. This file is the single source of truth for how to work in this repo, and a mistake here is a mistake for everyone.
