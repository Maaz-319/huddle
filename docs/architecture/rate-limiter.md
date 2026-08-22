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

---

## 3. Dimensions

| Dimension | Applies to | Notes |
|---|---|---|
| Per-user | All authenticated routes/WS events | Primary key once identity is known |
| Per-IP | Pre-auth routes (login, OAuth callback) and WS connection attempts | No user id yet; stops credential-stuffing/spam signups and reconnection storms |
| Per-channel | Message-send | Caps one user flooding a single channel's ~200 watchers, independent of their global per-user budget |

No global cross-route backstop per user — per-route buckets are the only cap.

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

- **REST:** middleware in front of Controllers — requests within budget pass through, requests over budget get a `429` without reaching Controllers.
- **WS events/frames:** checked inline in Chat Service on each incoming frame (message send, typing) — same bucket logic, invoked per-frame instead of per-HTTP-request, since these don't arrive as discrete HTTP requests.
- **WS connection attempts:** checked in the same socket.io `io.use()` middleware chain as handshake auth ([chat-service.md §2](./chat-service.md)), before a connection is established.

---

## 6. Client Feedback

- **REST:** `429` + `Retry-After` header, mirroring Discord's pattern of exposing rate-limit state so clients can back off proactively.
- **WS event/frame violation:** an error frame scoped to the offending event only — the message/event is dropped, the connection stays up.
- **WS connection-attempt violation:** rejected in the `io.use()` middleware — `next(new Error(...))` carrying a `retryAfter` value in the error's `data` payload, delivered to the client as a `connect_error` (no HTTP `429`/`Retry-After` header, since this isn't a raw HTTP response) — before any WS connection is established.

---

## 7. Escalation

- Per-event WS violations are tracked per user within a rolling window.
- **5 violations within 60 seconds → forced disconnect** of that WS connection (not just a dropped frame) — sustained abuse escalates beyond per-event error frames.

---

## 8. Open Questions / Future Enhancements

- Exact Redis key structure / bucket implementation details — deferred to the future data model / implementation doc.
- Whether budgets become admin-configurable at runtime vs. hardcoded constants — not yet specified.
- Additional route classes (e.g. server/channel create) may need explicit budgets beyond the classes listed in §4 — not yet enumerated exhaustively.
