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
- **Who may make a channel private:** the Owner and Moderators only, per PRD §5 — a question separate from the creation policy above. Under an `everyone` policy an ordinary Member may create channels, and is still refused if the request asks for a private one. Toggling an existing channel needs manage-channel-settings, which a Member never holds, so the same rule falls out of the guard there.
- **Flipping private → public keeps the channel's member list.** The `ChannelMember` rows go inert while the channel is public — nothing reads them — and mean the same thing again if it is flipped back. Deleting them on the flip would destroy the list on a misclick with nothing to rebuild it from.

---

## 4. Channel-Level Capability Overrides

- Anyone holding **manage-channel-settings on that channel** can set, **per channel and per role (Moderator, Member)**, an override on each of four capabilities:

  | Capability | Covers |
  |---|---|
  | **View** | Can see the channel and read its messages |
  | **Post** | Can send messages in the channel |
  | **Delete-others'-messages** | Moderation: deleting messages authored by other users |
  | **Manage-channel-settings** | Bundle: rename, delete, toggle private/public, edit this channel's own overrides, and (for private channels) add/remove members |

- Overrides can only **tighten**, never loosen, the server-wide default for that role (FR-13) — a channel cannot grant a Member delete rights they don't have server-wide, and cannot loosen a private server's channel to be more open than the server default.
- **Defaults:** Moderators have full delete-others'-messages and manage-channel-settings rights on every channel, unless that right is explicitly tightened (revoked) on a specific channel. Members follow the server-wide Member defaults (§5 of the PRD) unless tightened per channel.
- **Private-channel membership:** add/remove is part of manage-channel-settings — anyone (owner or mod) holding that capability on a given private channel can add/remove its members. A user must already be a server member (via the server invite) before they can be added to any channel, private or not. Adding a member to a *public* channel is refused: `ChannelMember` rows exist only for private channels (data-model.md §4.5), so the row would be data nothing ever reads.

### Who may write an override

The Owner always, and a Moderator on any channel where `manage_settings` has not
been revoked for `moderator` — PRD §5 gives "Apply channel-level overrides" to
both roles, and this doc puts "edit this channel's own overrides" inside the
manage-settings bundle. So all three override routes carry the same
`@RequireCapability('manage_settings')` as the rename, delete and membership
routes; the bundle is not split.

A Moderator can therefore revoke `manage_settings` from `moderator` on a channel,
locking their peers and themselves out of that channel's settings. **That is the
intended consequence of the capability being a bundle, not a bug** — and it is
recoverable, because the Owner is never overridable and can always delete the
row.

The write API cannot grant, by shape rather than by check: `PUT` only ever
creates a revocation row, the table has no value column, `DELETE` removes a
tightening rather than raising anyone above their server-wide default, and no
endpoint's success widens a capability. The two write-time refusals — `owner` as
a role, and `member` paired with `delete_others` or `manage_settings` — only
close the remaining no-op cases.

### Default capabilities by role

The server-wide starting point every channel tightens *down* from. Enforced by
`resolveCapability` in `apps/api/src/auth/resolve-capability.ts`, whose
`DEFAULT_CAPABILITIES` constant is this table.

| Capability | Owner | Moderator | Member |
|---|---|---|---|
| **View** | ✅ | ✅ | ✅ |
| **Post** | ✅ | ✅ | ✅ |
| **Delete-others'-messages** | ✅ | ✅ | ❌ |
| **Manage-channel-settings** | ✅ | ✅ | ❌ |

Channel object responses include `myCapabilities`, the authenticated caller's
effective capability names for that channel. The channel list still omits any
channel where the caller lacks `view`. This field lets the client present the
right actions; authorization for every operation remains server-side.

A Member never holds delete-others or manage-settings anywhere in the server, so
there is nothing for a channel override to take away — an override naming that
pair is inert rather than wrong.

### The Owner is never overridable, and never hidden

The Owner's column above is not merely "all four by default": it is **not
overridable at all**. Authority is defined at the server level and can never be
overridden by a channel (PRD §5), so `ChannelOverride.role` excludes `owner` at
the type level in both `schema.prisma` and the port — an owner override is
unrepresentable, not merely rejected.

The same rule applies to private channels: **an Owner sees and manages every
channel in their own server without a `ChannelMember` row.** `resolveCapability`
returns for an owner before either the membership or the override table is
consulted. A channel cannot lock its server's owner out of it.

### Hidden, not forbidden: `view` refusals are 404

A private channel is *fully hidden* from non-members (§3), so refusing a caller
`view` must not tell them the channel exists. `RequireCapabilityGuard` therefore
renders **every** `view` refusal as a `404` whose body is identical to the one
for a channel id that does not exist — whether the cause is a missing channel, a
non-member of the server, a private channel the caller is not in, or an override
that revoked `view`.

The last of those goes beyond a literal reading of the resolution order, which
would make an override-driven refusal a 403. It is deliberate: once the channel
listing is filtered by effective view capability (#54), a 403 on direct access
would confirm the existence of a channel the caller can never see listed. Refusals
of the other three capabilities keep their `403` — a caller asking to post or to
manage settings can already see the channel, so there is nothing left to hide.

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
- **Closed:** authoritative RBAC rule schema (how per-channel overrides are actually stored/queried). Overrides are `ChannelOverride` rows — `(channelId, role, capability)`, no value column, the row's existence *is* the revocation (data-model.md §4.6). They are read through `ChannelOverrideRepository` (`findByChannelId` for a single request, `findByChannelIds` for the channel listing's bulk pass) and written through the routes in §4. Resolution is one pure function, `resolveCapability` in `apps/api/src/auth/resolve-capability.ts`: owner bypass, then private-channel membership, then the role's server-wide default, then the override rows. `RequireCapabilityGuard` and the channel listing both call it, so a request and a listing cannot disagree about what a caller may see.
