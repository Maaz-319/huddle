# Component PRD — Chat Service

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

The Chat Service owns **real-time messaging**: message create/edit/delete, history pagination, typing indicators, and the fan-out of channel events to connected clients.

In scope:
- WebSocket transport model (connection lifecycle, event push)
- Message lifecycle (post, edit, soft-delete) and validation
- Real-time fan-out (in-process pub/sub)
- Private-channel visibility enforcement, including live revocation
- History pagination and reconnect catch-up
- Typing indicators
- Send acknowledgment & idempotency

Out of scope (this doc): permission *rules* (who can post/view/delete — owned by Administration Service's RBAC data, enforced via Auth Service per [auth-service.md §7](./auth-service.md)); connection/heartbeat tracking (owned by Presence module); rate limiting mechanics (owned by the cross-cutting Rate Limiter, see [CompleteApp.md §4.1](./CompleteApp.md)); message schema/storage details (deferred to the future data model file — this doc only lists the fields conceptually).

---

## 2. Real-Time Transport & Fan-Out Model

- **One WebSocket connection per client**, not one per channel — matches Discord's Gateway model. On connect, the server computes the set of channels the user is a member of (respecting private/invite-only channels) and pushes events for all of them; the client filters/renders based on which channel is currently open in the UI.
- **This single connection is shared/multiplexed** across concerns: chat events (this doc), presence heartbeat ping/pong and status broadcasts ([presence-module.md](./presence-module.md)), and per-event rate-limit checks/error frames ([rate-limiter.md](./rate-limiter.md)) all ride the same socket — there is no separate connection per concern.
- **Handshake auth:** the same session cookie used for REST ([auth-service.md §3](./auth-service.md)) is sent automatically on the WS handshake and validated in a socket.io `io.use()` middleware before the connection is accepted. Missing/expired/invalid session → the middleware calls `next(new Error(...))`, the client receives a `connect_error` (no HTTP status code involved), and no connection is established. The WS connection-attempt rate limit ([rate-limiter.md §6](./rate-limiter.md)) runs in this same middleware chain, for the same reason.
- **Fan-out mechanism: in-process, via socket.io rooms.** On connect, the server joins the client's socket to a room per accessible channel (`socket.join(channelId)`); message events are broadcast with `io.to(channelId).emit(...)`. Since Huddle runs as a single app instance (NFR-10), this needs no external broker. The socket.io Redis adapter is a documented future migration path if Huddle ever needs to run multiple instances (noted in Open Questions) — rooms still work unchanged, just backed by Redis instead of in-process state.
- **Live channel-membership revocation:** when a user's access to a channel changes (removed from a private channel, channel deleted, permissions tightened), the server calls `socket.leave(channelId)` on their connection and pushes a `channel_removed` event so the client drops the channel locally — the socket itself is not torn down.
- Membership/visible-channel list is recomputed fresh on every new connection (not cached indefinitely), in addition to the live revocation path above — so both an active session and a fresh reconnect always reflect current access.

---

## 3. Message Lifecycle

- **IDs:** Snowflake-style, sortable, timestamp-encoded — avoids needing a separate `created_at` column for ordering and gives natural cursors for pagination/catch-up.
- **Content limit:** 2048 characters.
- **Validation:** empty or whitespace-only messages are rejected; content is stripped (leading/trailing whitespace) before storage.
- **Content safety (defense in depth, both sides):**
  - Server stores content as plain text and never interprets it as HTML/markdown.
  - Client always escapes content on render (never raw-injects into the DOM) — protects against any future surface that might mishandle raw content (exports, admin views, etc).
- **Edits:** allowed indefinitely, no time limit; edited messages are flagged and display an "(edited)" marker (per PRD FR-17).
- **Deletes:** soft-delete only; deleted messages display "message deleted" in place of content (per PRD FR-18/19). Delete authorization (own messages always; owner/mod within their purview) is enforced via Auth Service per the existing RBAC model — not re-specified here.
- **Real-time events:** three distinct WS event types broadcast to channel viewers — `message_create`, `message_update`, `message_delete` — each carrying the message ID (and full payload for create/update) so clients patch their local message list in place rather than re-fetching.
- **Schema (conceptual only):** `id` (Snowflake), `channelId`, `authorId`, `content` (stripped), `createdAt` (derivable from Snowflake), `editedAt` (nullable), `isDeleted`/`deletedAt`. Authoritative schema to be defined in the future data model file.

---

## 4. Send Acknowledgment & Idempotency

- Each message send includes a **client-generated idempotency key** (a nonce, e.g. UUID).
- The server responds **directly** to the sender (separate from the broadcast) with either:
  - **Ack:** `{ idempotencyKey, messageId, createdAt }` — client swaps its optimistic "sending..." bubble for the real message.
  - **Error:** `{ idempotencyKey, error }` — client marks the bubble failed; non-retryable errors (e.g., forbidden, too long) stop client auto-retry, transient errors (e.g., rate-limited) allow it.
- The same idempotency key is used to **dedupe retries**: if the server sees a repeated key within the retention window, it returns the original result instead of creating a duplicate message. Client-side auto-retry (for some error classes) relies on this.
- **Idempotency key retention window: 30 seconds.**
- The normal `message_create` broadcast still fires to all channel viewers (including the sender, if subscribed) — the sender's UI updates from the direct ack, not by waiting for its own broadcast to loop back.

---

## 5. History Pagination

- **Cursor-based**, using the Snowflake message ID as the cursor: "give me ~50 messages before message ID X." Avoids the skip/duplicate bugs offset/page-number pagination has when new messages arrive mid-scroll.
- Page size: ~50 messages per load (per PRD §3), fetching older messages as the user scrolls up.

---

## 6. Reconnect / Catch-Up

- On reconnect (dropped connection, app restart, etc.), the client requests **all messages since the last message ID it had** (per channel), rather than just re-loading the latest page — guarantees no gap in the visible history regardless of how long the client was disconnected.
- This reuses the same underlying mechanism as pagination (query by Snowflake ID boundary), just in the opposite direction: "after X" for catch-up vs. "before X" for scroll-back history.

---

## 7. Typing Indicators

- Client sends a "typing" event on user input, **debounced server-side to at most once per ~3s per user per channel** — keeps this cheap on the server rather than firing on every keystroke.
- No explicit "stopped typing" event. The indicator **auto-clears client-side after ~5-10s of no new typing event** — handles closed tabs, dropped connections, and idle composing without needing a separate signal.

---

## 8. Open Questions / Future Enhancements

- **Redis pub/sub fan-out** — documented future migration path if Huddle ever runs multiple instances; not needed at current single-instance scale (NFR-10).
- Whether the idempotency-key dedupe window (30s) needs tuning once real client retry behavior is observed.
- Authoritative message schema — to be finalized in a future data model file; this doc's schema listing is conceptual only.
