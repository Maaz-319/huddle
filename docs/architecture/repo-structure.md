# Repo Structure

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

This doc defines the `apps/api` source layout and the pattern used to keep each service independent of the specific third-party tools it happens to use today (Redis, Postgres/Prisma, GitHub OAuth) — so any one of them can be swapped later by writing a new adapter class and changing one DI binding, without touching business logic.

Not covered here: `apps/web` (React) structure — a separate, lighter discussion later. Monorepo-level tooling (npm workspaces, hosting) is already decided in [tech-stack.md](./tech-stack.md).

**Guiding principle:** balanced, not maximal — enough separation to make the third-party pieces swappable and the codebase easy to extend, without full framework-free hexagonal purity. Nest's own DI system is the mechanism, not a hand-rolled one.

---

## 2. Top-Level Layout

```
apps/api/
  prisma/
    schema.prisma
    migrations/
  src/
    auth/
    administration/
    chat/
    presence/
    rate-limiter/
    common/
    main.ts
    app.module.ts
```

Each of `auth/`, `administration/`, `chat/`, `presence/`, `rate-limiter/` is a Nest `@Module`, matching the component split already locked in across the architecture docs ([CompleteApp.md §4](./CompleteApp.md)).

---

## 3. Per-Service Layout (flat, suffix-based)

No layered subfolders — files sit directly in the service folder, distinguished by filename suffix, matching Nest's own convention:

```
auth/
  auth.module.ts
  auth.controller.ts
  session-store.interface.ts
  oauth-provider.interface.ts
  auth.service.ts
  adapters/
    redis-session-store.adapter.ts
    github-oauth.adapter.ts
```

- **`*.controller.ts` / `*.gateway.ts`** — HTTP or WS entry point. Thin: validates input (DTOs), calls the service, shapes the response.
- **`*.service.ts`** — business logic. Depends only on the interface(s) below, never on a concrete adapter or a third-party client directly.
- **`*.interface.ts`** — the port. An abstract class (not a TS `interface`, since Nest needs a real token to bind against at runtime), e.g.:
  ```ts
  export abstract class SessionStore {
    abstract get(sessionId: string): Promise<Session | null>;
    abstract set(sessionId: string, session: Session): Promise<void>;
    abstract delete(sessionId: string): Promise<void>;
  }
  ```
- **`adapters/*.adapter.ts`** — the concrete implementation, the only place that imports the third-party client (`ioredis`, `PrismaClient`, `passport-github2`) directly.

**Wiring (in `auth.module.ts`):**
```ts
@Module({
  providers: [
    AuthService,
    { provide: SessionStore, useClass: RedisSessionStore },
    { provide: OAuthProvider, useClass: GithubOAuthAdapter },
  ],
})
export class AuthModule {}
```
Swapping Redis for something else later means writing a new class implementing `SessionStore` and changing the `useClass` line — `AuthService` and everything above it is untouched.

**The built reference:** `apps/api/src/auth/` holds a real, working example of every rule above — `user-repository.interface.ts` (the port), `adapters/prisma-user-repository.adapter.ts` (the only file there that injects `PrismaService`), and the one-line binding in `auth.module.ts`. It was built in Phase 1 specifically so later services are copied from working code rather than reconstructed from this prose. Two things it demonstrates that are easy to miss:

- **The port declares its own types.** `UserRepository` returns its own `User` interface, not Prisma's generated model. Re-exporting the vendor's type would put a Prisma import in every consumer and defeat the point of the port; the adapter maps its row onto the port's shape.
- **The port is where vendor errors stop.** The adapter translates Prisma's `P2002` and `P2025` into the shared `ConflictError` / `NotFoundError` from `common/errors.ts`, so no caller ever learns what a Prisma error code is.

---

## 4. Swappable Interfaces by Service

One real adapter is built per interface now — the interface is what makes a second adapter cheap to add later, not a second adapter built up front.

| Service | Interface (port) | Adapter (now) | Wraps |
|---|---|---|---|
| Auth | `UserRepository` | `PrismaUserRepository` | Postgres via Prisma ([auth-service.md §2](./auth-service.md)) — **built, the reference pair** |
| Auth | `SessionStore` | `RedisSessionStore` | Redis session storage ([auth-service.md §3](./auth-service.md)) |
| Auth | `OAuthProvider` | `GithubOAuthAdapter` | GitHub OAuth via Passport ([auth-service.md §2](./auth-service.md)) |
| Administration | `ServerRepository`, `MembershipRepository`, `ChannelRepository`, `InviteRepository` | Prisma-backed adapters | Postgres via Prisma ([data-model.md](./data-model.md)) |
| Chat | `MessageRepository` | `PrismaMessageRepository` | Postgres via Prisma ([chat-service.md §3](./chat-service.md)) |
| Presence | `PresenceStore` | `RedisPresenceStore` | Redis presence registry ([presence-module.md](./presence-module.md)) |
| Rate Limiter | `RateLimitStore` | `RedisRateLimitStore` | Redis token buckets ([rate-limiter.md §2](./rate-limiter.md)) |

**Not wrapped behind an interface:** socket.io. It's the core real-time transport the Chat/Presence/Rate-Limiter modules are built around ([tech-stack.md §3](./tech-stack.md)), not an interchangeable backing store — there's no realistic scenario where it gets swapped independently of a broader transport redesign.

---

## 5. Shared Code

`apps/api/src/common/` — code used by more than one service:
- Snowflake ID generator (`@sapphire/snowflake` wrapper)
- Shared DTOs / error types
- `PrismaService` — wraps `PrismaClient` as an injectable; **only adapter files inject it**, never a `*.service.ts` directly, keeping the Prisma dependency confined to the adapter layer.

---

## 6. Testing

**Every port gets both kinds of test.** A fake alone proves the port is usable, not that the real backend behaves that way; an adapter test alone leaves service unit tests needing Docker. Neither half is optional.

- **The fake** — in-memory, `Map`-backed, `extends` the same abstract class (e.g. `FakeUserRepository extends UserRepository`). `extends`, not duck-typing: adding a method to the port then breaks compilation in the fake, which is the only thing keeping it honest as the port grows. Hands out copies, never its stored objects — a caller mutating what it got back must not rewrite the store, because the real adapter would not behave that way.
- **The adapter integration test** — the real adapter against the real backend (Docker Postgres / Docker Redis), proving it satisfies the port's contract.

**The shared contract suite.** Both run the *same* assertions. A fake tested only by its own bespoke cases proves nothing about the adapter it stands in for. The convention, built out in `apps/api/test/fakes/user-repository.contract.ts`:

```ts
export function describeUserRepositoryContract(
  label: string,
  createRepository: () => Promise<UserRepository>,
): void { /* every behavioural assertion, once */ }
```

The fake's spec calls it with `() => Promise.resolve(new FakeUserRepository())`; the integration spec calls it with a factory that truncates the database and returns the adapter. Cases needing a real database — BigInt precision, columns the port does not expose — go in the integration spec, below the shared contract, not in it.

**Where the files live**, which is otherwise only discoverable by reading `apps/api/test/jest-integration.json`:

| Kind | Location | Suffix | Needs Docker | Run by |
|---|---|---|---|---|
| Unit | beside the source in `src/` | `*.spec.ts` | no | `npm test` |
| Fakes and contract suites | `apps/api/test/fakes/` | `*.spec.ts` for the fake's own run | no | `npm test` |
| Adapter integration | `apps/api/test/` | `*.integration-spec.ts` | yes | `npm run test:integration` |
| End to end | `apps/api/test/` | `*.e2e-spec.ts` | yes | `npm run test:e2e` |

`test/fakes/` is test-only code, so it stays out of `src/` — `apps/api/tsconfig.json` sets `rootDir: "./src"` and excludes `test/`, so a `src/` spec importing a fake would break both `npm run typecheck` and `nest build`. The unit Jest project therefore lists `test/fakes` in `roots` alongside `src`, which is what lets the fake's contract run under `npm test` without dragging the Docker-dependent suites in with it.

Integration tests target the separate `huddle_test` database (created by `docker/init.sql`) and truncate between cases via `truncateAll()` in `apps/api/test/prisma-test-client.ts`, so running the suite twice in a row passes both times.

Matches the focused-testing approach already set in [tech-stack.md §10](./tech-stack.md).

---

## 7. Open Questions / Future Enhancements

- `apps/web` (React) folder structure — not covered here, separate lightweight pass later.
- If Huddle ever needs framework-agnostic core logic (portable off Nest entirely), that would require pulling `*.interface.ts` and `*.service.ts` out of Nest's DI system into a plain package — deliberately not done now, judged unnecessary complexity for this project's scale.
- Whether Administration's four repository interfaces end up over-split in practice (e.g. `ServerRepository` and `MembershipRepository` merging into one) — revisit once real usage patterns emerge during implementation.
