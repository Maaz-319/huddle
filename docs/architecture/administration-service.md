# Component PRD — Administration Service

**Status:** Draft
**Date:** 2026-08-22
**Parent doc:** [CompleteApp.md](./CompleteApp.md)

---

## 1. Scope

The Administration Service owns **server & channel management**: server/channel CRUD, invite link lifecycle, role promotion, and the RBAC *rule storage* (channel-creation policy, per-channel capability overrides) that the Auth Service enforces.

In scope:
- Server lifecycle (create, rename, delete, ownership transfer)
- Channel lifecycle (create, rename, delete, visibility toggle)
- Channel-creation policy
- Invite link lifecycle
- Role promotion/demotion (member ↔ moderator)
- Per-channel capability overrides (the RBAC rule data itself)
- Private-channel membership management

Out of scope (this doc): permission *enforcement* (checking a resolved role/capability against an incoming request) — owned by Auth Service per [auth-service.md §7](./auth-service.md); this doc owns the rule *data*, Auth Service owns applying it. RBAC data schema/storage details are deferred to the future data model file — this doc lists rules conceptually.

---

## 2. Servers

- **Creation:** any authenticated user can create a server and becomes its Owner (FR-4).
- **Rename:** owner-only.
- **Deletion:** owner-only, **hard delete** (server, all channels, and all message history are permanently removed) — no soft-delete/undo. Client-side confirmation required before the request is sent; no server-side grace period.
- **Ownership transfer:** owner can transfer ownership to **any existing server member**, at any time, unilaterally. The only safeguards are (a) the target must already be a member of the server, and (b) client-side confirmation. The transfer is immediate — no acceptance step from the new owner. The **old owner becomes a regular Member** (not a mod).

---

## 3. Channels

- **Layout:** flat list of channels per server — no categories/grouping.
- **Creation policy (owner-configurable, per server):** one of
  - **Owner-only** — only the owner can create channels.
  - **Everyone** — any server member can create channels.
  - **Mods-only** — the owner and moderators can create channels.

  (No arbitrary hand-picked member list — collapsed to these three options to avoid unnecessary complexity.)
- **Rename / delete:** owner and moderators, by default — subject to being tightened per channel via the "manage-channel-settings" override (§4).
- **Visibility:** a channel can be toggled **private/invite-only**; private channels are **fully hidden** from non-members (do not appear in their channel list at all).

---

## 4. Channel-Level Capability Overrides

- The owner can set, **per channel and per role (Moderator, Member)**, an override on each of four capabilities:

  | Capability | Covers |
  |---|---|
  | **View** | Can see the channel and read its messages |
  | **Post** | Can send messages in the channel |
  | **Delete-others'-messages** | Moderation: deleting messages authored by other users |
  | **Manage-channel-settings** | Bundle: rename, delete, toggle private/public, edit this channel's own overrides, and (for private channels) add/remove members |

- Overrides can only **tighten**, never loosen, the server-wide default for that role (FR-13) — a channel cannot grant a Member delete rights they don't have server-wide, and cannot loosen a private server's channel to be more open than the server default.
- **Defaults:** Moderators have full delete-others'-messages and manage-channel-settings rights on every channel, unless the owner explicitly tightens (revokes) that right on a specific channel. Members follow the server-wide Member defaults (§5 of the PRD) unless tightened per channel.
- **Private-channel membership:** add/remove is part of manage-channel-settings — anyone (owner or mod) holding that capability on a given private channel can add/remove its members. A user must already be a server member (via the server invite) before they can be added to any channel, private or not.

---

## 5. Invites

- **One active invite link per server** — not multiple concurrent links (FR-7).
- Owners and moderators can **revoke and regenerate**; regenerating **replaces the link in place** (same "slot," new code) — the old code stops working immediately (FR-8).
- **Member invite-sharing toggle:** a separate **server-level** setting (owner-controlled) governing whether ordinary Members can generate/share the invite link, independent of the channel-creation policy and channel overrides.

---

## 6. Role Promotion

- Owner can **promote** a Member to Moderator, and **demote** a Moderator back to Member, at any time.
- No cap on the number of moderators per server.

---

## 7. Open Questions / Future Enhancements

- Invite link **expiration** and **max-use limits** (noted as future enhancements in the PRD, §12) — not built now; single permanent link only.
- Whether any confirmation/notification is sent to a member when they're promoted, demoted, or made owner — not yet specified.
- Authoritative RBAC rule schema (how per-channel overrides are actually stored/queried) — to be finalized in the future data model file, alongside the Chat Service's message schema.
