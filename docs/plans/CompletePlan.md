# Implementation Plan — Huddle Backend

**Status:** Draft
**Date:** 2026-08-22
**Parent docs:** [PRD.md](../PRD.md), [CompleteApp.md](../architecture/CompleteApp.md)

---

## 1. Context

All design work for Huddle is complete and locked across `docs/` — the PRD ([PRD.md](../PRD.md)), the system architecture ([CompleteApp.md](../architecture/CompleteApp.md)), per-component PRDs (auth, administration, chat, presence, rate-limiter), the authoritative data model ([data-model.md](../architecture/data-model.md)), the tech stack ([tech-stack.md](../architecture/tech-stack.md)), and the source layout ([repo-structure.md](../architecture/repo-structure.md)). What does **not** yet exist is any code: the repo contains only `docs/` and git history.

This document bridges that gap at the milestone level. It names the phases the project moves through, and what each phase contains in scope terms — **not how any of it is implemented**. Detailed per-phase breakdown (into GitHub issues) happens separately, at the start of each phase.

**Scope:** `apps/api` (NestJS backend) only. The React frontend (`apps/web`) and its structure doc are deliberately deferred and appear here only as a terminal placeholder.

**Shape:** backend vertical slices. Each phase after the foundation delivers a coherent, independently exercisable capability end-to-end through the stack (route/gateway → service → port → adapter → Postgres/Redis), verified by tests rather than by a UI. The exceptions are the two genuinely cross-cutting phases (persistence primitives, rate limiting), which have no vertical form.

---

## 2. Phases

### Phase 0 — Monorepo & Toolchain Foundation

- npm workspaces monorepo skeleton with `apps/api` as the only populated workspace (`apps/web` placeholder only).
- NestJS application bootstrap: root module, entry point, environment/config loading, global validation pipeline.
- Local development environment: Docker-based Redis, local/Neon Postgres connection, `.env` contract and example file.
- Repo hygiene: TypeScript config, linting/formatting, `.gitignore`, npm scripts (dev, build, test, migrate).
- Test harness wiring: unit test runner and the e2e test setup shell, so later phases have somewhere to put tests from day one.

### Phase 1 — Persistence & Shared Primitives

- Full Prisma schema for every entity in [data-model.md](../architecture/data-model.md) — User, Server, Membership, Channel, ChannelMember, ChannelOverride, Invite, Message — with the documented keys, constraints, and indexes (including the one-owner-per-server partial unique index and the message pagination index).
- Initial generated migration; migration workflow established.
- Shared code in `common/`: Snowflake ID generator, injectable Prisma wrapper, shared error and DTO types.
- Redis client provisioning as a shared, injectable concern.
- The port/adapter convention established concretely once, as the reference pattern every later service follows: abstract-class port, adapter folder, module-level DI binding.
- The paired testing convention established once: in-memory fake adapter for unit tests, plus a real-backend integration test for the real adapter.

**Why this phase is horizontal:** every vertical slice below writes to the same schema; splitting the schema across phases would mean repeatedly migrating tables that the design already fully specifies.

### Phase 2 — Rate Limiting Primitive

- The single shared token-bucket primitive (capacity + refill), atomic against Redis, behind its own port.
- REST enforcement layer sitting in front of controllers, with the documented rejection response and retry signalling.
- The bucket/dimension configuration surface — per-user, per-IP, per-channel — with the starting budgets from [rate-limiter.md](../architecture/rate-limiter.md) as tunable constants.
- Unit coverage of burst/refill/exhaustion behaviour and an integration test of the real Redis-backed store.
- WS-side enforcement (per-event checks, connection-attempt limiting, escalation-to-disconnect) is **not** built here — it lands in Phase 8 with the transport it guards, reusing this same primitive.

**Why this comes before auth:** it is a dependency-free primitive, and building it first means the auth routes (the strictest pre-auth buckets in the design) are protected from birth rather than retrofitted.

### Phase 3 — Identity & Sessions

- GitHub OAuth login flow end to end: initiation, provider redirect, callback handling, CSRF state validation, failure/denial handling.
- User provisioning on first login and profile re-sync on every subsequent login.
- Opaque session issuance, validation, sliding expiry, and revocation, backed by a server-side session store behind its own port.
- Session cookie policy and the authenticated-request resolution path that every later phase depends on.
- Logout (current device) and account deletion (access revocation, message history preserved).
- Multi-device concurrent sessions.
- Per-IP rate limits applied to the login and callback routes.

**Delivers:** a caller can authenticate, be recognized on subsequent requests, and log out. Every phase after this assumes an authenticated identity exists.

### Phase 4 — Servers, Membership & Server-Level Authority

- Server lifecycle: create (creator becomes owner), rename, hard delete.
- Membership records and role assignment; ownership transfer with its documented safeguards and demotion of the previous owner.
- Server-level settings storage: channel-creation policy and the member-invite toggle.
- The server-scoped authority guard (`@RequireRole`) — the first half of the RBAC enforcement mechanism — resolving the caller's role in the target server from session identity.
- Role promotion and demotion (member ↔ moderator).
- "Which servers do I belong to" and server-detail reads.

**Delivers:** the authority half of the permission model — who someone *is* — enforced server-side.

### Phase 5 — Invites & Joining

- One invite row per server, created with the server.
- Invite code generation, revocation, and in-place regeneration (old code dies immediately).
- Join-by-code flow: validating a code and adding the caller as a Member.
- Enforcement of who may view/share the invite, per the server's member-invite toggle.
- Strict rate limits on the regeneration and join paths.

**Delivers:** a second user can actually get into a server — the precondition for every multi-user behaviour that follows.

### Phase 6 — Channels, Overrides & Effective Capability

- Channel lifecycle: create (gated by the server's channel-creation policy), rename, delete, private/public toggle.
- Private-channel membership management (add/remove), and full hiding of private channels from non-members in every read path.
- Channel-level capability override storage — the tighten-only rule data, per role and capability.
- The channel-scoped capability guard (`@RequireCapability`) — the second half of RBAC — resolving server role, then applying the channel's overrides to compute an effective capability.
- The tighten-only invariant enforced at write time: an override can never grant a capability the role lacks server-wide, and a channel can never elevate authority.
- Channel listing filtered by the caller's effective view capability.

**Delivers:** the complete permission model, both layers, enforced server-side. This is the phase the PRD names as a core learning objective.

### Phase 7 — Message Persistence & History

- Message creation, edit (with edited marker), and soft delete, all through the capability guard.
- Deletion authorization covering the three cases: own message, owner anywhere, moderator within their purview.
- Content validation and normalization, and storage as inert plain text.
- Cursor-based history pagination backwards over a channel's messages, at the documented page size.
- The forward-direction query (messages after a given ID) that reconnect catch-up will consume in the next phase.
- Per-channel and per-user message-send rate limits applied.

**Delivers:** the full message lifecycle over plain request/response — correct and testable before real-time push is layered on top.

### Phase 8 — Real-Time Transport

- The WebSocket gateway: a single multiplexed connection per client.
- Handshake authentication reusing the same session mechanism as REST, plus connection-attempt rate limiting, both in the pre-connection middleware chain.
- Room-based subscription: computing the caller's accessible channel set on every connection and subscribing them, recomputed fresh on each reconnect.
- Message event broadcast — create, update, delete — to channel subscribers.
- Direct send acknowledgment to the sender, with client-supplied idempotency keys and short-window retry deduplication.
- Typing indicators with server-side debounce and no explicit stop event.
- Reconnect catch-up, consuming the forward query from Phase 7.
- Live access revocation: unsubscribing a connection and notifying it when channel access is removed or tightened, without tearing down the socket.
- WS-side rate limiting: per-event checks reusing the Phase 2 primitive, scoped error frames, and escalation to forced disconnect on sustained abuse.

**Delivers:** the primary PRD acceptance criterion — a message sent by one client appearing on another, live.

### Phase 9 — Presence

- Connection registry behind its own port: user → set of active connections, backed by Redis.
- Liveness via the transport's built-in heartbeat, tuned to the documented detection window.
- Clean vs. dirty disconnect handling, and global online/offline computation across a user's multiple connections.
- Status-transition-only broadcast to everyone sharing at least one server with the user.
- One-time presence snapshot for a set of users, so a connecting client can establish initial state before relying on live updates.

**Delivers:** the live green-dot data, and the disconnect-flips-offline acceptance criterion.

### Phase 10 — Acceptance Verification & Hardening

- An end-to-end suite walking each acceptance criterion in [PRD §9](../PRD.md) as a scenario, using real multi-client WebSocket connections.
- Explicit adversarial checks: a tampered client blocked server-side on every guarded operation, private channels invisible in every read path, revoked invites dead.
- A throughput/concurrency sanity check against the PRD's stated targets.
- Consolidation pass: error response consistency, logging, config validation on boot, and any rate-limit budget tuning the real behaviour suggests.
- Closing out the open questions the design docs deliberately left for implementation time (e.g. whether the four administration repository ports are over-split).

### Phase 11 — Deployment

- Backend on Render, Postgres on Neon, Redis on Redis Cloud — all free tier.
- Production configuration and secret management; migration execution against the hosted database.
- Verifying WebSocket behaviour through the hosting proxy, and characterizing free-tier cold-start and reconnect behaviour under it.
- Deciding, with real data, the open question of whether the cold-start tradeoff is acceptable or warrants a different host.

### Phase 12 — Frontend (deferred, out of scope here)

Placeholder only. The React app requires its own elicitation and design pass first — `apps/web` structure, state management, socket client, and routing are explicitly unspecified in [repo-structure.md](../architecture/repo-structure.md). Nothing in Phases 0–11 assumes a UI exists.

---

## 3. Structural Contract

Everything is created from scratch; there is no existing code to modify. The layout is already fixed by [repo-structure.md](../architecture/repo-structure.md):

- `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/` — authored once in Phase 1 from [data-model.md](../architecture/data-model.md), migrated by generator, never hand-written.
- `apps/api/src/{auth,administration,chat,presence,rate-limiter}/` — one Nest module each, matching the locked component split. Flat and suffix-based inside: `*.controller.ts` / `*.gateway.ts`, `*.service.ts`, `*.interface.ts`, `adapters/*.adapter.ts`.
- `apps/api/src/common/` — Snowflake generator, Prisma wrapper, shared DTOs and error types. Only adapter files may inject the Prisma wrapper.
- Ports are abstract classes bound via `{ provide: Port, useClass: Adapter }` in the owning module. Business logic never imports a third-party client; only its adapter does. socket.io is the documented exception and is not wrapped.

---

## 4. Verification Approach

There is no UI in this plan, so every phase is verified in code:

- **Per phase:** unit tests of service logic against in-memory fakes, plus an integration test for each new real adapter against real Docker Redis / Postgres — the paired convention set in Phase 1.
- **Phases 3–7:** exercised through the HTTP surface in e2e tests, including negative cases where a caller lacking a role or capability is rejected.
- **Phases 8–9:** exercised with multiple real socket clients in one test — two clients in a channel for delivery and typing, a dropped connection for the presence flip, a reconnect for catch-up, and a mid-session revocation for the unsubscribe path.
- **Phase 10:** the [PRD §9](../PRD.md) acceptance criteria as the definitive gate, each as a named scenario.
- **Phase 11:** the same real-time scenarios re-run against the deployed environment, since proxy behaviour is the specific risk being tested.

---

## 5. Open Questions / Future Enhancements

- Frontend design pass (`apps/web` structure, state management, socket client, routing) — required before Phase 12 can be scoped.
- Whether Phase 10's throughput check warrants a dedicated load-testing tool or a scripted client is sufficient.
- Per-phase issue breakdown is deliberately not enumerated here; it is produced at the start of each phase.
