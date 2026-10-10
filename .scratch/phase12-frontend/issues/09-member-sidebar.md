# 09: Member Sidebar — Presence, Real-time Online/Offline

**What to build:** Right sidebar showing all members of the current server with live presence (green dot = online). Updates in real-time via `presence_online` / `presence_offline` events. Search/filter for large servers.

**Blocked by:** 04-socket-layer, 05-app-shell, 06-server-management

**Status:** ready-for-agent

- [ ] `usePresenceStore` (Zustand) with:
  - `onlineUserIds: Set<string>` — from `presence_online` / `presence_offline` events
  - `fetchSnapshot(userIds)` — `GET /presence/snapshot?userIds=...` on initial load
  - `isOnline(userId)` → boolean
- [ ] `MemberSidebar` component:
  - Header: "Members (N)" — count updates live
  - List: online users first (green dot), then offline (no dot)
  - Each member row: Avatar, username, role badge (Owner/Moderator/Member), online indicator
  - Green dot: `accent-electric`, 8px, positioned bottom-right of avatar
  - Click member → context menu (future: DM, profile, mod actions)
  - Search input (debounced 200ms) filters list by username
  - Virtualized for 500+ members (TanStack Virtual)
- [ ] Real-time updates:
  - `presence_online` → add to `onlineUserIds` → re-render (user moves to top section)
  - `presence_offline` → remove from `onlineUserIds` → re-render (user moves to bottom)
  - Animation: 120ms slide + fade for section transitions
- [ ] Initial load: on server select, fetch all member IDs → `fetchSnapshot()` → hydrate `onlineUserIds`
- [ ] `MemberSidebar` only renders for current server (from URL)
- [ ] Empty state: "No members in this server"
- [ ] Error boundary per `MemberSidebar`
- [ ] Responsive: drawer on tablet/mobile (from AppShell)