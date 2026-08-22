# Tech Stack

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

This doc locks in the concrete technology choices deferred by [PRD.md §10](../PRD.md): transport library, database, hosting, and which pieces of each component's design (Auth, Administration, Chat, Presence, Rate Limiter) are built on an established framework/library versus custom code. Principle applied throughout: **prefer an established, genuinely industry-used library over custom code — but only where it doesn't compromise an already-decided requirement** (e.g. token-bucket bursting, PKCE-level hardening where it isn't load-bearing, RBAC model shape).

---

## 2. Backend

- **Framework: NestJS** (TypeScript). Its module system maps directly onto the already-locked component split (Auth Service, Administration Service, Chat Service, Presence module, Rate Limiter), and its decorator/guard model (`@UseGuards()`, `CanActivate`) matches the "declarative enforcement" language already used in [CompleteApp.md §4](./CompleteApp.md).
- **Monorepo:** plain **npm workspaces** — `apps/api` (NestJS) and `apps/web` (React) — no build-orchestration tool (Turborepo/Nx) needed at this scale.
- **Config:** `@nestjs/config` for environment/secrets management (Postgres, Redis, GitHub OAuth, session secret).
- **Validation:** `class-validator` + `class-transformer` for DTOs — the standard Nest pairing.
- **API docs (optional):** `@nestjs/swagger` — near-zero cost once DTOs/decorators exist.

---

## 3. Real-Time Transport (WebSockets)

- **Library: socket.io**, via Nest's `@WebSocketGateway()`.
- **Fan-out:** socket.io **rooms** — `socket.join(channelId)` on connect/access-grant, `io.to(channelId).emit(...)` for broadcast. Replaces the originally-documented manual connection lookup ([chat-service.md §2](./chat-service.md)). No external broker needed at single-instance scale (NFR-10); the socket.io Redis adapter is the documented future migration path for multi-instance.
- **Single connection per client**, multiplexing chat, presence, and rate-limit-error events — no socket.io namespaces (which would behave like separate connections); only rooms are used, scoped to channels.
- **Heartbeat:** socket.io's built-in engine.io ping/pong, tuned via `pingInterval: 10000` / `pingTimeout: 20000` (~30s worst-case dead-connection detection, matching PRD FR-23) — no separate custom heartbeat ([presence-module.md §3](./presence-module.md)).
- **Handshake auth + WS connection-attempt rate limiting:** both run in the same `io.use()` middleware chain, before a connection is accepted. Rejection surfaces to the client as a `connect_error` (with a `retryAfter` payload for the rate-limit case) — not an HTTP status code, since this is below the raw HTTP upgrade layer that `allowRequest` would hook into. See [chat-service.md §2](./chat-service.md) and [rate-limiter.md §5–6](./rate-limiter.md).

---

## 4. Data Layer

- **Database: PostgreSQL** — free-tier relational DB per PRD §3, hosted on **Neon**.
- **ORM: Prisma** — type-safe queries/migrations, standard pairing with Nest + Postgres.
- **Message IDs:** `@sapphire/snowflake` — maintained by the Discord.js ecosystem for this exact purpose, fitting given Huddle explicitly models Discord's Snowflake ID scheme ([chat-service.md §3](./chat-service.md)).
- **Redis** (sessions, rate-limit buckets, presence registry): **Docker Redis** locally, **Redis Cloud** (free tier, persistent small instance, unlimited requests) in production. Chosen over Upstash's per-request-billed model given how frequently Redis is hit here (every request/WS event for rate limiting, every heartbeat for presence, every request for session lookup).

---

## 5. Auth & Sessions

- **Sessions:** `express-session` + `connect-redis` — the industry-standard combo for an opaque session ID in an `HttpOnly`/`Secure`/`SameSite=Lax` cookie, backed by server-side Redis state. Matches the already-decided design in [auth-service.md §3](./auth-service.md) almost exactly; no custom session implementation needed.
- **OAuth:** `@nestjs/passport` + `passport-github2` — the standard Nest OAuth integration. **No PKCE**: dropped in favor of Passport's stock Authorization Code flow. GitHub doesn't require PKCE, and it was defense-in-depth layered on top of (not a replacement for) `state`-param CSRF protection, which Passport provides natively via its session-backed `state: true` option. See [auth-service.md §2](./auth-service.md).

---

## 6. Authorization (RBAC)

- **No third-party authorization library** (e.g. CASL) — the permission model (3 server roles, 4 channel-level capabilities, tighten-only overrides) is simple enough not to need one, and hand-building the guard is deliberate system-design practice.
- **Mechanism:** two custom decorators built on Nest's own `SetMetadata`/`Reflector` — `@RequireRole(...)` for server-level authority checks, `@RequireCapability(...)` for channel-scoped operations (resolves server role → channel override table → effective capability). Adding a new protected operation is just adding a decorator. See [auth-service.md §7](./auth-service.md).

---

## 7. Rate Limiting

- **No `@nestjs/throttler`** — kept as originally designed: a **custom token-bucket** implementation (Redis + Lua for atomicity), because:
  - `@nestjs/throttler`'s algorithm is a time-window counter, not token-bucket burst+refill — adopting it would walk back the explicit choice to allow bursts rather than a hard window cliff ([CompleteApp.md §4.1](./CompleteApp.md)).
  - It only covers REST; WS per-event checks, connection-attempt limiting, and escalation-to-disconnect would still need custom Redis logic regardless.
  - A single shared `checkAndConsume(key, capacity, refillRate)` primitive serves REST middleware, WS event checks, and WS connection-attempt checks uniformly — less total surface area than splitting between an off-the-shelf REST library and fully custom WS code.
- Full design: [rate-limiter.md](./rate-limiter.md).

---

## 8. Frontend

- **Framework: React**, hosted on **Vercel** (free tier, zero-config for a Vite/React SPA build).

---

## 9. Hosting Summary

| Piece | Provider | Notes |
|---|---|---|
| Backend (NestJS + socket.io) | **Render** (free tier) | Long-lived process, supports WS. Free tier spins down after ~15min idle — accepted tradeoff (cold start / reconnect on first request after idle) for zero cost. |
| Frontend (React) | **Vercel** (free tier) | Static SPA hosting. |
| Postgres | **Neon** (free tier) | Serverless Postgres, pairs with Prisma. |
| Redis | **Redis Cloud** (free tier) in prod, **Docker** locally | Persistent small instance, unlimited requests — fits high-frequency small-op usage pattern (sessions, rate limits, presence). |

All free-tier, consistent with NFR-10.

---

## 10. Testing

- **Approach: focused, not exhaustive** — appropriate for a portfolio project, while still practicing test-writing (a stated PRD learning goal).
- **Unit tests (Jest, Nest's default):** the logic worth verifying in isolation — RBAC guard resolution (`@RequireRole`/`@RequireCapability`, including tighten-only override resolution) and the token-bucket rate-limiter primitive.
- **E2E tests (Nest's e2e testing module + `socket.io-client`):** the real-time flows named in [PRD §9 Acceptance Criteria](../PRD.md) — message delivery between two clients, presence flip on disconnect, typing indicator, permission enforcement (tampered client blocked server-side), invite lifecycle, edit/delete semantics, history pagination.
- **Frontend:** no dedicated test suite planned initially — manual verification in-browser per the project's real-time nature; may add Vitest + React Testing Library later if needed.

---

## 11. Open Questions / Future Enhancements

- Whether Render's cold-start behavior on the free tier is acceptable in practice once the app is live, or whether to migrate to Fly.io later for an always-on instance.
- Whether `@nestjs/swagger` API docs are worth wiring up given time constraints — optional, not blocking.
- Structured logging (e.g. `nestjs-pino`) — not decided; Nest's built-in Logger is sufficient for now.
- Frontend automated testing (Vitest + RTL) — deferred, not decided against permanently.
