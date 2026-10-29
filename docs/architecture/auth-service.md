# Component PRD — Auth Service (incl. RBAC enforcement)

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

The Auth Service owns **identity, session, and authorization enforcement** as a single module — RBAC enforcement is not split out separately because it sits directly on top of the session/identity data this module already owns.

In scope:
- GitHub OAuth login/signup (Authorization Code + PKCE)
- Session issuance, validation, sliding expiry, and revocation
- Logout (single device)
- Account deletion (access revocation only)
- RBAC enforcement (role/permission checks consumed by Administration & Chat services — role/permission *data* is owned by Administration, per [CompleteApp.md §4](./CompleteApp.md))

Out of scope (this doc): the RBAC *data model* (role definitions, channel overrides) — that lives with the Administration Service. This doc covers identity/session and the enforcement mechanism only.

---

## 2. Identity & OAuth

- **Provider:** GitHub OAuth **App** (not a GitHub App), Authorization Code flow, implemented via **Passport.js** (`@nestjs/passport` + `passport-github2`) — the industry-standard OAuth integration for Nest, rather than a hand-rolled client.
- **No PKCE:** dropped in favor of Passport's standard flow — GitHub doesn't require it, and it was defense-in-depth on top of (not a replacement for) the `state`-param CSRF protection below, which Passport already provides natively.
- **CSRF protection on the OAuth redirect itself:** the `state` parameter is generated per login attempt, stored server-side (tied to the pending login, via `passport-github2`'s built-in `state: true` session-backed option — using the same session store as §3), and validated on callback.
- **Scopes requested:** `read:user` + `user:email` — enough for id, username, avatar, and email.
- **Profile provisioning (first login):** creates a user record from GitHub's `id` (source of truth, immutable), `login` (username), `avatar_url`, and email.
- **Profile re-sync (every login):** username, avatar, and email are re-fetched and overwritten from GitHub on each login — Huddle never lets a user set a different handle locally. GitHub's numeric `id` is the durable key; if a GitHub username changes, Huddle's copy updates on next login.
- **Email:** captured and stored from first login, but **not used for anything yet** (no verification flow, no notifications) — reserved for a possible future email module.
- **Bulk public profile lookup:** `GET /auth/users` returns only id, username, avatar, and bio to signed-in users. Email remains available only through the caller's own `GET /auth/me` response.
- **GitHub token retention:** the GitHub access token is used once to fetch the profile, then **discarded** — not persisted, since nothing else in Huddle calls the GitHub API.
- **OAuth failure/denial:** if the user denies the GitHub prompt or GitHub returns an error, redirect to the login page with an error message. No retry-flow beyond letting the user click "log in" again.

---

## 3. Session Design

- **Cookie:** `Secure`, `HttpOnly`, `SameSite=Lax`. Lax (not Strict) because the OAuth callback redirect from GitHub is a top-level navigation that must still carry the cookie.
- **Contents:** an **opaque session ID** — not a JWT. A JWT can't be revoked before its own expiry, which conflicts with real logout and sliding expiry.
- **Storage:** server-side session store in **Redis** (same Redis instance already used by the rate limiter — see [CompleteApp.md §4.1](./CompleteApp.md)), keyed by session ID → `{ userId, createdAt, lastSeenAt, expiresAt }`.
- **Expiry:** **sliding 7-day window** — each authenticated REST request extends the Redis session by 7 days. WebSocket transport heartbeats check the session but do not extend it; after 7 days without an authenticated REST request, the session expires and its sockets close.
- **Expired/invalid session mid-use:** protected endpoints return `401`; the frontend redirects to the login page. No silent re-auth.
- **CSRF on state-changing requests:** every REST mutation requires an `Origin` exactly matching configured `WEB_ORIGIN`; missing and other origins are rejected. Browser socket handshakes use the same allowlist. OAuth callback navigation is exempt. `SameSite=Lax` remains defense in depth.
- **Remote server icons:** HTTPS URLs are accepted, with `no-referrer` on browser image requests. The remote host still receives the viewer's IP and request metadata; this is an accepted product tradeoff.
- **Implementation note (Phase 3):** this is built as `express-session` + `connect-redis` directly, not behind a hand-rolled `SessionStore` port — a deliberate, confirmed exception to the port/adapter convention (`AGENTS.md` §2), the same status as socket.io ([repo-structure.md §4](./repo-structure.md)). `connect-redis`'s `RedisStore` reuses the app's existing injectable Redis connection rather than opening a second one. `rolling: true` on the cookie session is what gives the sliding 7-day expiry above — every request that touches the session pushes `expiresAt` back out, with no separate "touch" logic needed.

---

## 4. Multi-Device Sessions

- **Multiple concurrent sessions per user are allowed**, uncapped (laptop + phone + etc. simultaneously) — natural fit for the opaque-session-ID-in-Redis design, since each login just creates an independent session key.
- Sessions are fully independent: activity on one device does not extend another device's expiry, and revoking one session does not affect others.
- **Presence tie-in:** a user's global online/offline status (PRD FR-22) is derived from *any* active session/connection being live — consistent with the Presence module already tracking multiple connections per user.

---

## 5. Logout

- **Scope:** logs out the current device/browser only — clears that session's cookie and deletes its Redis entry. Other devices' sessions are untouched.
- Sockets authenticated by that session are disconnected immediately; account deletion disconnects every live socket for the user. Connected sockets also re-check the Redis session on each existing heartbeat and close after expiry or revocation.
- **"Log out everywhere" (kill all sessions for a user):** **deferred to a future enhancement.** Not built now, but the data model supports adding it cheaply later via a secondary Redis index (`userId → {sessionIds}`) alongside the existing per-session store.

---

## 6. Account Deletion

- Deleting an account **revokes login access only** — it does not delete or anonymize the user's historical messages.
- Past messages keep the user's **last-known username** and remain attributed to them as normal (no "deleted user" placeholder).
- All of that user's active sessions are invalidated immediately on deletion.

---

## 7. RBAC Enforcement

- The Auth Service is the enforcement point: on each request, it resolves the authenticated user from the session, then checks their role/permissions (data owned by Administration Service) before Administration or Chat Service acts.
- Enforcement is always server-side (PRD NFR-5) — never trusts client-reported role/permission state.
- Authority (server-level role) vs. capability (channel-level override) distinction and the actual permission table are defined in the PRD (§5) and owned by the Administration Service's data model — not duplicated here.
- **Mechanism:** two custom decorators, built on Nest's built-in `SetMetadata`/`Reflector` (not a third-party authorization library — the model is simple enough not to need one):
  - **`@RequireRole(...)`** — for server-scoped authority checks (e.g. promote member, delete server). The guard compares the session's resolved server role directly against the decorator's allowed-roles list.
  - **`@RequireCapability(...)`** — for channel-scoped operations (post, view, delete-others'-messages, manage-channel-settings). The guard resolves the user's server role, then looks up that channel's override table (Administration Service's data, tighten-only per `administration-service.md` §4) to compute the *effective* capability before allowing/denying.
  - Adding a new protected operation is then just adding the appropriate decorator to its route/gateway handler — no guard logic to rewrite.

---

## 8. Open Questions / Future Enhancements

- "Log out everywhere" (kill all sessions for a user) — noted above, not built now.
- Whether a numeric cap on the sliding-expiry ceiling is needed (e.g., absolute max session age regardless of activity) — not raised as a concern yet, revisit if needed.
- Future email module usage of the captured email address — unspecified beyond storage.
