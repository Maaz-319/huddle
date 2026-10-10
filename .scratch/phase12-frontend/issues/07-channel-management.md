# 07: Channel List, Creation, Settings & Overrides UI

**What to build:** Channel management within a server — list channels (filtered by permissions), create channel, rename, toggle private, delete, manage private channel members, view/edit channel overrides (tighten-only). All gated by permissions (backend enforces; UI reflects capabilities).

**Blocked by:** 05-app-shell, 06-server-management

**Status:** ready-for-agent

- [ ] `useChannelStore` (Zustand) with:
  - `channelsByServer: Map<serverId, ChannelResponse[]>` — from `GET /servers/:id/channels`
  - `currentChannelId: string | null` — from URL
  - `fetchChannels(serverId)` — called on server select
  - `createChannel(serverId, { name, isPrivate })` — `POST /servers/:id/channels`
  - `updateChannel(channelId, { name, isPrivate })` — `PATCH /channels/:id`
  - `deleteChannel(channelId)` — `DELETE /channels/:id`
  - `getChannel(channelId)` — `GET /channels/:id`
  - `listOverrides(channelId)` — `GET /channels/:id/overrides`
  - `revokeCapability(channelId, role, capability)` — `PUT /channels/:id/overrides/:role/:capability`
  - `restoreCapability(channelId, role, capability)` — `DELETE /channels/:id/overrides/:role/:capability`
  - `addChannelMember(channelId, userId)` — `POST /channels/:id/members` (private channels)
  - `removeChannelMember(channelId, userId)` — `DELETE /channels/:id/members/:userId`
- [ ] `ChannelList` component (in shell):
  - Groups: none for MVP (future: categories)
  - Channel item: `#` prefix for text, 🔒 for private, strikethrough if no `view` capability
  - Click → navigate to `/app/@serverId/@channelId`
  - Right-click / `⋮` → context menu (requires `manage_settings`):
    - "Edit Channel" → rename / toggle private dialog
    - "Manage Members" (private only) → member management drawer
    - "Overrides" → overrides management drawer
    - "Delete Channel" → confirm (type name) → `deleteChannel()`
- [ ] "Create Channel" dialog (from `+` in ChannelList or server context menu):
  - Name input (required, unique per server — backend validates)
  - "Private Channel" checkbox
  - If private: member picker (multi-select from server members) — opens after create or inline
  - Submit → `createChannel()` → navigate to new channel
- [ ] "Edit Channel" dialog: same fields, pre-filled
- [ ] Private channel member management (drawer):
  - List current members (avatars + names + roles)
  - "Add Members" → multi-select from server members not in channel
  - Remove member → `removeChannelMember()` (owner/mod only)
- [ ] Channel overrides management (drawer):
  - Table: Role (moderator/member) × Capability (view, post, delete_others, manage_settings)
  - Checkbox = revoked (tighten-only); unchecked = inherits server default
  - Owner row shown but disabled (never overridable)
  - Toggle → `revokeCapability()` / `restoreCapability()`
  - Tooltip on each capability explaining what it controls
- [ ] Permission-aware rendering: channels without `view` hidden entirely (backend filters); `manage_settings` checks before showing edit/delete/overrides
- [ ] Real-time: `channel_added` / `channel_removed` events → update store → UI reacts (highlight new, redirect if current removed)