# 12: Polish, Integration & End-to-End Verification

**What to build:** Final integration pass — connect all features, verify real-time flows against running backend, fix cross-cutting issues, polish interactions, ensure accessibility and responsiveness.

**Blocked by:** 06-server-management, 07-channel-management, 08-message-pane, 09-member-sidebar, 10-settings-page, 11-error-boundaries

**Status:** ready-for-agent

- [ ] **End-to-end verification** (manual, against running backend):
  - [ ] Sign in with GitHub → lands on `/app` with server list
  - [ ] Create server → appears in list → navigate → create channel → send message
  - [ ] Open second browser/incognito → sign in as different user → join via invite → see message in real-time
  - [ ] Edit message → "(edited)" appears on both clients
  - [ ] Delete message → "message deleted" on both
  - [ ] Typing indicator → appears on other client while typing
  - [ ] Presence → green dot appears when second user connects, disappears on disconnect/tab close
  - [ ] Private channel → only invited members see it
  - [ ] Channel override (mod-only post) → member blocked from posting (server-side 403)
  - [ ] Invite revoke → old link fails, new link works
  - [ ] Reconnect catch-up → close tab, reopen → missed messages appear
  - [ ] Rate limit → spam messages → `policy_violation` disconnect → re-auth works
- [ ] **Accessibility audit**:
  - [ ] All interactive elements keyboard reachable
  - [ ] Focus visible (focus-visible ring: `accent-electric`)
  - [ ] ARIA labels on icon-only buttons
  - [ ] Live regions for toasts, typing indicator, presence changes
  - [ ] Color contrast (WCAG AA) — verify all text/background combos
  - [ ] Reduced motion respected (`prefers-reduced-motion` disables animations)
- [ ] **Responsive verification**:
  - [ ] Desktop (≥1024px): three-pane, no horizontal scroll
  - [ ] Tablet (768px): drawers work, no layout shift
  - [ ] Mobile (375px): bottom nav, single pane, touch targets ≥44px
- [ ] **Performance**:
  - [ ] Virtualized lists for messages (1000+) and members (500+)
  - [ ] No unnecessary re-renders (Zustand selectors, React.memo where needed)
  - [ ] Bundle size check: `npm run build` → analyze (`vite-bundle-analyzer` or `rollup-plugin-visualizer`)
  - [ ] Lazy load settings page, invite preview (code splitting)
- [ ] **Polish**:
  - [ ] Skeleton loaders for all async data
  - [ ] Empty states with illustrations (SVG) for servers, channels, messages, members
  - [ ] Micro-interactions: button press scale, hover transitions (120ms), drawer slide (200ms)
  - [ ] Scrollbar styling (thin, `accent-electric` thumb on hover)
  - [ ] Selection highlight on message click (brief `bg-raised` flash)
  - [ ] Timestamp tooltip: absolute time on hover
  - [ ] Copy message text context menu item
  - [ ] Markdown not supported (plain text only) — verify no XSS
- [ ] **Build & Deploy prep**:
  - [ ] `npm run build` passes (typecheck + lint + build)
  - [ ] `VITE_API_URL` / `VITE_WS_URL` configurable for production
  - [ ] Output to `apps/web/dist` for Vercel deployment
  - [ ] README update with frontend setup commands
- [ ] **Known limitations documented** (for README):
  - No unread badges / notifications
  - No command palette
  - No DMs / group DMs
  - No rich text / markdown
  - No reactions / threads
  - Avatar only from GitHub (no upload)