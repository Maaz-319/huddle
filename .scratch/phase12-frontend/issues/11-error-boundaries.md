# 11: Error Boundaries & Global Error Handling

**What to build:** Per-feature error boundaries for graceful degradation, global error handler for uncaught promise rejections, and user-friendly error UI with retry actions.

**Blocked by:** 05-app-shell, 08-message-pane, 09-member-sidebar, 10-settings-page

**Status:** ready-for-agent

- [ ] `ErrorBoundary` component (class component or `react-error-boundary`):
  - `fallback` prop: receives `{ error, resetErrorBoundary }`
  - `onReset` logs to console (dev) or error reporting service (future)
  - `resetKeys` — reset when key changes (e.g., channelId)
- [ ] Feature-specific boundaries:
  - `<MessagePaneErrorBoundary>` — wraps `MessagePane`; fallback: "Failed to load messages" + Retry button (calls `fetchHistory`)
  - `<ChannelListErrorBoundary>` — wraps `ChannelList`; fallback: "Failed to load channels" + Retry
  - `<MemberSidebarErrorBoundary>` — wraps `MemberSidebar`; fallback: "Failed to load members" + Retry
  - `<SettingsTabErrorBoundary>` — wraps each settings tab; fallback: inline error + retry
  - `<ServerListErrorBoundary>` — wraps `ServerList`; fallback: "Failed to load servers" + Retry
- [ ] Global error handler:
  - `window.addEventListener('unhandledrejection', ...)` → log + toast "Something went wrong. Please refresh."
  - `window.addEventListener('error', ...)` → same
- [ ] Toast system (lightweight, no library):
  - `useToastStore` (Zustand) — `toasts: Toast[]`, `add(message, type: 'success' | 'error' | 'info', duration?)`, `dismiss(id)`
  - `<Toaster />` at root of `AppShell` — renders stack (bottom-right)
  - Types: success (green), error (red), info (blue)
  - Auto-dismiss: 5s (error: 8s), hover to pause
- [ ] API error handling (centralized):
  - `apiClient` wrapper: 401 → clear auth, redirect to `/`; 403 → toast "You don't have permission"; 404 → "Not found"; 5xx → "Server error, please try again"
  - Network error → "Connection failed. Check your network."
- [ ] Socket error handling:
  - `policy_violation` → toast "Disconnected: too many requests" + forced re-auth
  - `connect_error` with `retryAfter` → show "Rate limited. Retrying in Xs..." + auto-reconnect
- [ ] Accessibility: error announcements via `aria-live="polite"` region