# Component PRD — Rate Limiter

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

The Rate Limiter is **cross-cutting middleware at the Controller/Gateway layer** — not a peer service like Auth, Administration, Chat, or Presence. It caps request/event volume per user, per IP, and per channel to prevent abuse and accidental floods, and guards against WS reconnection storms.

In scope:
- Token-bucket rate limiting for REST requests (middleware in front of Controllers)
- Token-bucket rate limiting for WS events/frames (checked inline in Chat Service, per frame)
- WS connection-attempt limiting (separate from per-event buckets)
- Escalation to forced disconnect on sustained WS abuse
- Client-facing feedback on rejection (REST and WS)

Out of scope:
- Becoming a standalone service — not warranted at Huddle's target scale (~1,000 concurrent users, single instance); Redis-backed middleware is sufficient (PRD §5, industry precedent).
- A global cross-route backstop per user (e.g. Discord's 50 req/s) — per-route buckets are judged sufficient at this scale.
- Multi-instance/distributed coordination beyond what Redis already provides as shared state.

---

## 2. Algorithm & Storage

- **Algorithm:** token bucket, matching Discord's own approach — allows bursts (e.g. pasting a few messages quickly) while capping sustained abuse, rather than a hard fixed-window cliff.
- **Storage: Redis**, from day one. Centralized bucket state stays correct even if Huddle later runs more than one instance — avoids a rework later, at the cost of a Redis dependency now (acceptable: Redis has a free tier and runs locally at zero cost, consistent with NFR-10).
- **Key structure:** `huddle:rl:<policy>:<dimension>:<id>`, e.g. `huddle:rl:message-send:channel:8901234567890123`. `<policy>` is a named budget from §4, `<dimension>` is one of `user` / `ip` / `channel` per §3, and `<id>` is the Snowflake or address that dimension keys on. One Redis hash per bucket, holding the token count and the timestamp it was last refilled from.
- **Atomicity:** the whole check-and-consume is a single Lua script. A read-modify-write spread across separate commands is a race that lets two concurrent requests spend the same last token.
- **Expiry:** every bucket carries a TTL set to how long it would take to refill to full, so idle buckets disappear rather than accumulating. Nothing about correctness depends on a bucket surviving a Redis restart — a lost bucket is a *full* bucket, which is the safe direction to fail in.

---

## 3. Dimensions

| Dimension | Applies to | Notes |
|---|---|---|
| Per-user | All authenticated routes/WS events | Primary key once identity is known |
| Per-IP | Pre-auth routes (login, OAuth callback) and WS connection attempts | No user id yet; stops credential-stuffing/spam signups and reconnection storms |
| Per-channel | Message-send | Caps one user flooding a single channel's ~200 watchers, independent of their global per-user budget |

No global cross-route backstop per user — per-route buckets are the only cap.

**What "IP" means.** Behind a TLS-terminating proxy ([tech-stack.md §9](./tech-stack.md) puts the backend on Render) the socket address is the proxy's, so every caller would land in one shared bucket and rate-limit each other. The client address is resolved through Express's `trust proxy` with an explicit, configured hop count — never `true`, which would let any client forge `X-Forwarded-For` and mint itself an unlimited supply of fresh buckets.

**Temporary, until Phase 3.** A user-dimensioned bucket has no caller id to key on before sessions exist, so it falls back to the per-IP dimension rather than going unlimited. Remove this note once identity resolution lands.

---

## 4. Buckets (Starting Budgets, Tunable)

| Route class | Bucket |
|---|---|
| Message send | ~5 tokens burst, refill ~1/sec |
| Typing indicator | Cheap bucket + server-side debounce (don't fan out every keystroke) |
| Login / OAuth callback (per-IP) | Strict, e.g. 5/min |
| Invite regenerate, role promotion | Strict, e.g. 3/min |
| Reads (history, Open GET points) | Generous |
| **WS connection attempts (per-IP)** | ~5 attempts/min |

---

## 5. Enforcement Points

- **REST:** a **guard** in front of Controllers — requests within budget pass through, requests over budget get a `429` without the handler ever running.

  **Why a guard and not middleware.** Budgets are declared per route with a `@RateLimit('policy')` decorator, and Nest middleware runs *before* the router has resolved a handler, so it cannot read that metadata — it would have to match budgets against URL patterns in a side table, which drifts out of step the moment a path changes. A guard reads the decorator through `Reflector`, still rejects before the controller body runs, and is the same mechanism `@RequireRole` and `@RequireCapability` use for RBAC ([auth-service.md §7](./auth-service.md)) — one enforcement idiom in the codebase rather than two.

  **Coverage is opt-in.** Only a route carrying `@RateLimit(...)` is limited; an undecorated route makes no Redis call at all. That follows from §3: per-route buckets are the only cap, so there is nothing for an unmarked route to fall back to. `GET /health` is deliberately unlimited — a probe that gets `429`d reads as an outage.
- **WS events/frames:** checked inline in Chat Service on each incoming frame (message send, typing) — same bucket logic, invoked per-frame instead of per-HTTP-request, since these don't arrive as discrete HTTP requests.
- **WS connection attempts:** checked in the same socket.io `io.use()` middleware chain as handshake auth ([chat-service.md §2](./chat-service.md)), before a connection is established.

---

## 6. Client Feedback

- **REST, rejection:** `429` + a `Retry-After` header, in the standard error body shape (`{ "error": { "code": "RATE_LIMITED", ... } }`). `Retry-After` is whole seconds **rounded up** — a `Retry-After: 0` tells a client to retry immediately, which is the opposite of the intent.
- **REST, every rate-limited response:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, on the allowed responses too. This is the half of Discord's pattern that lets clients back off *proactively*; `Retry-After` alone only tells a client what to do once it has already been rejected.
- **WS event/frame violation:** an error frame scoped to the offending event only — the message/event is dropped, the connection stays up.
- **WS connection-attempt violation:** rejected in the `io.use()` middleware — `next(new Error(...))` carrying a `retryAfter` value in the error's `data` payload, delivered to the client as a `connect_error` (no HTTP `429`/`Retry-After` header, since this isn't a raw HTTP response) — before any WS connection is established.

---

## 7. Escalation

- Per-event WS violations are tracked per user within a rolling window.
- **5 violations within 60 seconds → forced disconnect** of that WS connection (not just a dropped frame) — sustained abuse escalates beyond per-event error frames.

---

## 8. Open Questions / Future Enhancements

- Whether budgets become admin-configurable at runtime vs. hardcoded constants — not yet specified.
- Additional route classes (e.g. server/channel create) may need explicit budgets beyond the classes listed in §4 — not yet enumerated exhaustively.
