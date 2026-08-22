# Component PRD — Presence Module

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

The Presence module owns the **live connection registry** and **online/offline state** for every user: tracking active WebSocket connections, handling heartbeats, and broadcasting status changes to relevant clients.

In scope:
- Connection registry (userId → active connections)
- Heartbeat / liveness detection
- Clean and dirty disconnect handling
- Online/offline state computation (per user, global — not per-server)
- Presence broadcast to relevant clients
- Initial presence snapshot on client connect

Out of scope:
- **Per-server presence** — presence is global: a user is online everywhere or offline everywhere (PRD §11, FR-22).
- **Idle/away states** — binary online/offline only; richer states are a future enhancement (PRD §12).
- **Last-seen timestamps** — offline is offline, with no "last seen X ago" exposed or stored.
- Auth session validation (JWT handshake) — owned by Auth Service; Presence is consulted only after the WS connection is authenticated.

---

## 2. Connection Model

- Storage: **Redis-backed** registry mapping `userId → set of active connections`, each connection tracking its own liveness.
- A user supports **multiple simultaneous connections** (multiple tabs/devices).
- A user's global status is **online if at least one connection is active**; only flips to offline when **all** of their connections have dropped or timed out.

---

## 3. Heartbeat

- Liveness is detected via **socket.io's built-in engine.io heartbeat** (ping/pong) — no separate app-level heartbeat message, and no custom mechanism built on top of it.
- Tuned via server config (not left at socket.io's defaults, which would give a laxer ~45s): `pingInterval: 10000` (10s), `pingTimeout: 20000` (20s) — worst-case dead-connection detection ≈ interval + timeout ≈ **~30s**, matching FR-23.

---

## 4. Disconnect Handling

- **Clean disconnect** (tab closed, graceful WS close): that connection is removed from the registry **immediately**; if it was the user's last active connection, they flip offline immediately.
- **Dirty disconnect** (network drop, crash, no graceful close frame): the connection is only removed after the **~30s heartbeat timeout** elapses with no pong.

---

## 5. Presence Broadcast

- A broadcast fires **only on a status transition** (online→offline or offline→online) — not on every heartbeat, to minimize traffic.
- **Audience:** everyone who shares at least one server with the user (no per-viewer/per-channel targeting).
- **No reconnect debounce:** a page refresh may cause a brief offline→online flicker; this is accepted as a simplicity tradeoff rather than smoothed over.

---

## 6. Initial State Sync

- On client connect (or when opening a server), the client fetches a **one-time snapshot** of current online status for the relevant set of user IDs (e.g., a server's member list).
- After the snapshot, the client relies on live push updates (§5) to stay current — no polling.

---

## 7. Open Questions / Future Enhancements

- Richer presence states (idle/away) beyond binary online/offline (PRD §12).
- Last-seen timestamps — not built now; explicitly deferred/excluded.
- Notifications/unread indicators tied to presence — not yet specified (PRD §12).
