# Product Requirements Document — Discord Channels (working name: "Huddle")

**Status:** Draft
**Author:** Product elicitation session
**Date:** 2026-08-13
**Project type:** Learning / portfolio project (real-time systems, architecture, implementation practice)

---

## 1. Purpose / Overview

Huddle is a stripped-down, real-time community chat application modeled on the core of Discord. Users create **servers** (communities), organize conversations into **channels**, chat in **real time**, and see **who is online** via live presence. There is no voice, video, or bot support — the focus is the essential mechanics of a live, multi-user text chat platform.

The product exists primarily as a vehicle for practicing system design, software architecture, and implementation. Two problems make it worth building:

1. **Server-pushed real time.** Unlike a request/response app, the server must push new messages, presence changes, and typing indicators to clients the instant they happen.
2. **Layered permissions.** A permission system with real depth: rules defined at the server level, with individual channels able to *tighten* (but never loosen) those defaults.

Getting these two right — real-time delivery and "who can do what, where" — is the core learning objective.

---

## 2. Goals / Objectives

**Product goals**

- Deliver a working real-time chat app where messages, presence, and typing indicators propagate to all relevant clients in near real time (target sub-200ms delivery within one region).
- Implement a correct three-tier permission model (Owner / Moderator / Member) with channel-level overrides that can only restrict access further.
- Run entirely on free-tier or local infrastructure (no paid message brokers, no sharding required).

**Learning goals**

- Practice designing and implementing a push-based real-time transport (e.g., WebSockets) including fan-out to many subscribers.
- Practice presence tracking via heartbeats and connection lifecycle handling.
- Practice a non-trivial authorization model with inheritance and overrides.
- Practice paginated history loading over a growing dataset.

**Success is measured by** the acceptance criteria in Section 9 rather than by user-growth metrics, since this is a portfolio project.

---

## 3. Scale & Capacity Targets

These targets are deliberately chosen to be architecturally interesting while remaining runnable on free/local infrastructure (a single app instance with WebSockets + one free-tier relational database).

| Dimension | Target |
|---|---|
| Total servers | ~100 |
| Members per server | up to ~500 |
| Concurrent online users (total) | ~1,000 |
| Concurrent users watching one channel | ~200 |
| Sustained message throughput | ~50 messages/sec |
| Message delivery latency (same region) | < 200 ms |
| History page size | ~50 messages per load |
| Message retention | Retain all history indefinitely |

---

## 4. Target Audience / User Personas

**Primary persona — "The Member" (normal user).**
A person who wants to join communities and chat, much like a typical Discord user. They sign in, join a server via an invite link, pick a channel, read recent conversation, post messages, and see who else is around. The product's default flows are optimized for this person.

**Secondary persona — "The Owner."**
A user who creates a server and governs it: invites people, sets up channels, decides who can create channels, promotes moderators, and can make channels private. Governs via elevated permissions but is fundamentally the same kind of user.

**Tertiary persona — "The Moderator."**
A trusted member promoted by the owner. Manages channels and moderates messages within their purview; can revoke/regenerate invite links; cannot override the owner's authority.

---

## 5. Roles & Permission Model

Three roles exist per server: **Owner**, **Moderator**, **Member**.

**Authority vs. capability — the core rule.** There are two distinct layers:

- **Authority (who someone *is*)** — role assignment (Owner/Mod/Member) and ownership are defined at the **server level and can never be overridden by a channel.** The owner is the owner everywhere; a channel cannot promote, demote, or strip anyone's server role.
- **Capability (what someone can do *in a specific channel*)** — view / post / manage rights **can be tightened by a channel-level override**, but never loosened beyond the server default. Example: a public server may contain one mod-only channel; a channel cannot make a private server public.

**Default capabilities by role**

| Capability | Owner | Moderator | Member |
|---|---|---|---|
| Create/delete server | ✅ (own) | ❌ | ❌ |
| Invite (via link) | ✅ | ✅ | Configurable* |
| Revoke / regenerate invite link | ✅ | ✅ | ❌ |
| Promote member → moderator | ✅ | ❌ | ❌ |
| Create channels | Configurable by owner** | ✅ (if allowed) | Configurable** |
| Make a channel private | ✅ | ✅ | ❌ |
| Apply channel-level overrides | ✅ | ✅ | ❌ |
| Post messages | ✅ | ✅ | ✅ (where permitted) |
| Edit/delete own messages | ✅ | ✅ | ✅ |
| Delete anyone's message | ✅ (all) | ✅ (channels they oversee) | ❌ |
| View channel | ✅ | ✅ | ✅ (unless private/overridden) |

\* Whether ordinary members can generate/share invites follows the owner's server settings.
\** The owner decides who may create channels: only the owner, everyone, or a hand-picked list of trusted members.

---

## 6. User Stories / Use Cases

**Identity & entry**

- As a new user, I can sign in with **GitHub OAuth** so I get an identity without managing a password. *(Google OAuth is a planned future addition.)*
- As a user, I can create a server and automatically become its Owner.
- As an owner, I can generate a **permanent invite link** and share it so others can join.
- As a user with an invite link, I can open it and join that server.

**Chatting (primary flow)**

- As a member, I can select a channel and see recent messages, loading ~50 at a time as I scroll up into history.
- As a member, I can post a plain-text message and have everyone watching that channel see it instantly, without refreshing.
- As a member, I can see a live "so-and-so is typing…" indicator while another user composes a message.
- As a member, I can see which users are online across the server via a live green-dot sidebar that updates as people connect/disconnect.
- As a member, I can edit my own message; it shows an **"(edited)"** marker afterward.
- As a member, I can delete my own message; it is soft-deleted and shows **"message deleted"** in place.

**Administration (first-class flows)**

- As an owner, I can **promote a member to moderator.**
- As an owner or moderator, I can **create a private (invite-only) channel** visible only to specified members.
- As an owner or moderator, I can delete any message in channels I oversee (basic moderation).
- As an owner or moderator, I can **revoke and regenerate** the server's invite link, invalidating the old one.
- As an owner, I can configure who is allowed to create channels (only me / everyone / a trusted list).

---

## 7. Functional Requirements

**7.1 Authentication & Identity**

- FR-1. The system authenticates users via GitHub OAuth; on first login it provisions a user profile (id, username/handle, avatar).
- FR-2. Sessions persist so returning users are recognized without re-authenticating each visit.
- FR-3. The architecture keeps the auth provider pluggable so Google OAuth can be added later without reworking identity.

**7.2 Servers**

- FR-4. Any authenticated user can create a server and becomes its Owner.
- FR-5. Each server has a name and an owner; ownership is unique and server-scoped.
- FR-6. The owner may configure the channel-creation policy: owner-only, everyone, or a specified trusted list.

**7.3 Invites**

- FR-7. A server has a **permanent, reusable invite link/code** anyone with it can use to join.
- FR-8. Owners and moderators can **revoke** the current link and **regenerate** a new one; the revoked link stops working immediately.
- FR-9. Following a valid invite link adds the user to the server as a Member.
- *(Future: expiration and max-use caps on links.)*

**7.4 Channels**

- FR-10. Users permitted by the server's channel-creation policy can create channels within a server.
- FR-11. Channels have a name (e.g., `#general`) and belong to exactly one server.
- FR-12. A channel can be marked **private/invite-only**, visible only to explicitly added members.
- FR-13. A channel can carry permission **overrides** that further restrict (never expand) the server defaults (e.g., mod-only posting in an otherwise-open server).
- FR-14. Owners and moderators can manage (create/rename/delete/configure) channels within their purview.

**7.5 Messaging**

- FR-15. Users can post plain-text messages to channels they can access.
- FR-16. New messages are pushed to all connected clients currently viewing that channel in real time (no client polling).
- FR-17. Users can **edit** their own messages; edited messages display an "(edited)" marker.
- FR-18. Users can **delete** their own messages; deletion is a **soft delete** that displays "message deleted" in place of the content.
- FR-19. Owners (any channel) and moderators (channels they oversee) can delete any message; deleted messages show "message deleted."
- FR-20. Channel history is loaded in pages of ~50 messages, fetching older messages as the user scrolls up.
- FR-21. While a user is composing, a **typing indicator** is broadcast to others viewing the same channel and clears when they stop or send.

**7.6 Presence**

- FR-22. Each user has a single global online/offline status, visible consistently across every server they belong to (no per-server presence).
- FR-23. Presence is determined by a **heartbeat**: an active connection sending periodic pings is "online"; a missed-heartbeat timeout (e.g., ~30s) flips the user to "offline," so a closed tab or dropped connection correctly shows offline.
- FR-24. Presence changes are pushed live to relevant clients, updating the green-dot sidebar without refresh.

---

## 8. Non-Functional Requirements

**Performance**

- NFR-1. Message and presence updates delivered in < 200ms within a single region under target load (Section 3).
- NFR-2. Sustain ~50 messages/sec and ~1,000 concurrent connections on a single app instance + free-tier database.

**Real-time transport**

- NFR-3. Use a server-push transport (e.g., WebSockets) with efficient fan-out to channel subscribers; avoid client polling for messages, presence, and typing.
- NFR-4. Gracefully handle connect/reconnect/disconnect, including heartbeat timeouts and client re-subscription on reconnect.

**Security**

- NFR-5. All authorization decisions (view/post/manage/delete) are enforced **server-side**; clients never self-report permissions.
- NFR-6. OAuth tokens/secrets are stored securely and never exposed to the client beyond what the flow requires.
- NFR-7. Private channels and channel overrides are enforced on the server for both reads (history/subscription) and writes.

**Usability**

- NFR-8. Real-time updates appear without manual refresh; the UI reflects live message arrival, presence, and typing.
- NFR-9. Clear visual affordances: online green dots, "(edited)" markers, "message deleted" placeholders, typing indicators.

**Reliability & Cost**

- NFR-10. Runs on free-tier or local infrastructure; no paid message broker or database sharding required at target scale.
- NFR-11. All message history is retained durably and remains paginable.

---

## 9. Success Metrics / Acceptance Criteria

Because this is a learning/portfolio project, success is defined by demonstrable technical behavior rather than adoption:

- **Real-time delivery:** With two clients in the same channel, a message sent by one appears on the other in < 200ms without a refresh.
- **Presence correctness:** Closing a tab / dropping the connection flips the user to offline within the heartbeat timeout on all other clients.
- **Typing indicator:** Appears for other viewers while composing and clears on send/stop.
- **Permission enforcement:** A channel override (e.g., mod-only) is enforced server-side; a Member is blocked from posting even if the client is tampered with. A channel cannot elevate a role or override the owner's authority.
- **Invite lifecycle:** A permanent link admits users; after an owner/mod revokes it, the old link no longer works and a regenerated link does.
- **Edit/delete semantics:** Edited messages show "(edited)"; deleted messages soft-delete to "message deleted"; owners/mods can delete others' messages within scope.
- **History pagination:** Scrolling up loads older messages ~50 at a time over a large backlog without loading everything at once.
- **Scale sanity check:** The system sustains target throughput/concurrency on free/local infra without a paid broker.

---

## 10. Design Considerations

- **Mockups:** None yet. UI should mirror Discord's basic layout — server list, channel list, message pane, and an online-members sidebar with green dots.
- **Tech stack:** Intentionally deferred. Stack choices (transport library, database, hosting) will be decided in a separate **spec file**, constrained by the free/local requirement and the real-time/permission needs above.

---

## 11. Out of Scope

- Voice or video calls
- Screen sharing
- Bots, integrations, or slash commands
- Rich media embeds, reactions, threads
- Per-server presence (presence is global: online everywhere or offline everywhere)
- Google OAuth, invite expiry/max-uses (noted as future enhancements, not in initial scope)

---

## 12. Open Questions / Future Enhancements

- Add **Google OAuth** as a second provider.
- Invite link **expiration** and **max-use** limits.
- Richer presence states (idle/away) beyond binary online/offline.
- Notifications / unread indicators (not yet specified).
- Decide final tech stack in the forthcoming spec file.
