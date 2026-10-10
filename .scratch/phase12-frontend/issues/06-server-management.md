# 06: Server List, Creation, Invite Preview & Join

**What to build:** Complete server management UI — list user's servers, create new server, invite preview via code, join server via invite. All mutations use REST API with optimistic updates where appropriate.

**Blocked by:** 05-app-shell

**Status:** ready-for-agent

- [ ] `useServerStore` (Zustand) with:
  - `servers: ServerResponse[]` — from `GET /servers`
  - `currentServerId: string | null` — from URL
  - `fetchServers()` — called on auth hydration and after mutations
  - `createServer(name, iconUrl?)` — `POST /servers` → optimistic add → replace on response
  - `deleteServer(serverId)` — `DELETE /servers/:id` → remove from list
  - `updateServer(serverId, { name, iconUrl? })` — `PATCH /servers/:id`
  - `getInvite(serverId)` — `GET /servers/:id/invite` → `{ code, revokedAt, createdAt }`
  - `revokeInvite(serverId)` — `DELETE /servers/:id/invite`
  - `regenerateInvite(serverId)` — `POST /servers/:id/invite/regenerate`
- [ ] `ServerList` component (in shell):
  - Server icons (first letter of name, colored background from hash)
  - Hover → tooltip with server name
  - Click → navigate to `/app/@serverId`
  - `+` button → "Create Server" dialog (name input, optional icon URL)
- [ ] "Create Server" dialog (Radix Dialog):
  - Form: name (required, max 100 chars), icon URL (optional)
  - Submit → `createServer()` → close dialog → navigate to new server
- [ ] Server context menu (right-click / `⋮`):
  - "Invite People" → opens invite dialog
  - "Server Settings" → navigate to `/app/@serverId/settings` (placeholder)
  - "Leave Server" → confirm → `DELETE /servers/:id` (if owner: transfer ownership first, future)
  - "Delete Server" (owner only) → confirm (type name) → `deleteServer()`
- [ ] Invite dialog:
  - Shows invite link: `${WEB_ORIGIN}/invite/${code}`
  - Copy button (clipboard API + toast)
  - "Revoke Invite" (owner/mod) → `revokeInvite()` → link becomes invalid
  - "Regenerate Invite" (owner/mod) → `regenerateInvite()` → new code shown
  - Member invite toggle respected (backend enforces; UI shows/hides based on role)
- [ ] Invite preview page (`/invite/:code`):
  - `GET /invites/:code` → shows server name, icon
  - "Join Server" button → `POST /invites/:code/join` → on success, redirect to `/app/@serverId`
  - If already member → redirect to `/app/@serverId`
  - Invalid/expired code → error state with "Invite expired or invalid"
- [ ] All API calls use centralized `apiClient` with error handling (401 → logout, 403 → toast, 404 → not found)