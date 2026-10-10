# 10: Settings Page — Profile, Appearance, Account Actions

**What to build:** User settings page at `/settings` — profile editing (bio, avatar URL), appearance (message density), logout, delete account. All mutations via REST API.

**Blocked by:** 03-auth-flow, 05-app-shell

**Status:** ready-for-agent

- [ ] Route: `/settings` (protected, in `AppShell` or standalone layout)
- [ ] `SettingsPage` with tabs (Radix Tabs): Profile, Appearance, Account
- [ ] **Profile tab**:
  - Current avatar (large, 128px)
  - Avatar URL input (optional) — `PATCH /auth/me` with bio only for MVP; avatar sync from GitHub on login (backend handles)
  - Bio textarea (max 300 chars, char counter) — `PATCH /auth/me` on blur/debounce
  - Username display (read-only, from GitHub)
  - Email display (read-only)
  - "Save" button (or auto-save with debounce)
- [ ] **Appearance tab**:
  - Message Density: Radio group (Compact / Cozy) — updates `localStorage` + CSS variable immediately
  - Preview: sample message showing current density
  - Future: theme (dark only for MVP), font size
- [ ] **Account tab**:
  - "Log Out" button (secondary) → `useAuthStore.getState().logout()` → redirect to `/`
  - "Delete Account" button (destructive) → Confirm dialog (type "DELETE") → `useAuthStore.getState().deleteAccount()` → redirect to `/`
  - Warning text: "This permanently deletes your account. Your messages will remain but show as 'Deleted User'."
- [ ] All forms use React Hook Form + Zod validation
- [ ] Toast notifications for success/error
- [ ] Error boundary per tab