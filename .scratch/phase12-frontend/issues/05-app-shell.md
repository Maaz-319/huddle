# 05: App Shell, Routing & Responsive Layout

**What to build:** The authenticated app shell (`/app/*`) with TanStack Router, three-pane desktop layout, collapsible drawers on tablet, bottom-tab navigation on mobile. All state in URL — deep linkable, refreshable. Protected by auth guard.

**Blocked by:** 01-project-setup, 02-design-system, 03-auth-flow

**Status:** ready-for-agent

- [ ] TanStack Router setup:
  - `createRouter` with `routeTree.gen.ts` (file-based routes)
  - Root route `/` → landing (public)
  - Auth route `/auth/callback` → callback handler
  - Protected route `/app/*` — `beforeLoad` checks auth, redirects to `/`
  - Route tree:
    - `/app` → `AppShell` (redirects to first server or `/app/@serverId`)
    - `/app/@serverId` → `ServerView` (channel list + empty message pane)
    - `/app/@serverId/@channelId` → `ChannelView` (message pane + composer)
    - `/app/@serverId/settings` → `ServerSettings` (future)
  - Search params for message pagination (`?before=`, `?after=`) — optional
- [ ] `AppShell` component:
  - Left: `ServerList` (fixed 64px, icon-only)
  - Center-left: `ChannelList` (240px, collapsible)
  - Center: `MessagePane` (flex: 1, max-width 720px centered)
  - Right: `MemberSidebar` (240px, collapsible)
  - All panes render simultaneously on desktop; state in URL
- [ ] Responsive breakpoints:
  - Desktop (≥1024px): three-pane as above
  - Tablet (640–1023px): ServerList always visible (56px); ChannelList & MemberSidebar as slide-over drawers (Radix Dialog + custom animation)
  - Mobile (<640px): Bottom navigation (4 tabs: Servers, Channels, Messages, Members); single pane visible; ServerList becomes full-screen modal
- [ ] `ServerList` — vertical icon stack, active server highlighted, `+` button for create server (opens dialog)
- [ ] `ChannelList` — grouped by category (none for MVP), channel type icons (`#` text, 🔒 private), unread indicator (future), right-click → context menu (Radix DropdownMenu)
- [ ] `MemberSidebar` — online users first (green dot), then offline; search/filter (future); roles shown via badge
- [ ] URL sync: selecting server/channel updates URL; browser back/forward works; refresh restores exact view
- [ ] Keyboard navigation: `Tab` moves logically, `Escape` closes drawers/modals, `Cmd/Ctrl+K` placeholder for command palette (deferred)