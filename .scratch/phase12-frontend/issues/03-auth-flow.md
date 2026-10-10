# 03: Auth Flow & State — GitHub OAuth, Session, Persisted Store

**What to build:** Complete authentication flow — GitHub OAuth login, callback handling, session hydration, logout, account deletion. Auth state persisted to `localStorage` for instant reload. `useAuthStore` (Zustand) provides user, login/logout actions, and hydration.

**Blocked by:** 01-project-setup, 02-design-system

**Status:** ready-for-agent

- [ ] `useAuthStore` (Zustand) with:
  - `user: User | null` — `{ id, username, avatarUrl, email, bio }`
  - `isHydrated: boolean` — true after localStorage read
  - `login()` — redirects to `/auth/github`
  - `logout()` — calls `POST /auth/logout`, clears store
  - `deleteAccount()` — calls `DELETE /auth/me`, clears store
  - `hydrate()` — reads `localStorage.getItem('auth')`, validates shape, sets user
  - `persist` middleware — saves `user` to `localStorage` on change
- [ ] `GET /auth/me` API client (TanStack Query or fetch wrapper) — called on hydration if user exists
- [ ] `/auth/callback` route — receives redirect from backend, calls `GET /auth/me`, hydrates store, redirects to `/app`
- [ ] Landing page (`/`) — "Sign in with GitHub" button (primary), minimal hero
- [ ] `SessionAuthGuard` equivalent: route loader / `beforeLoad` that checks `useAuthStore.getState().user`; redirects to `/` if missing
- [ ] Logout button in settings — calls `logout()`, redirects to `/`
- [ ] Delete account button in settings — confirm dialog → `deleteAccount()` → redirect to `/`
- [ ] Cookie handling: backend sets `connect.sid` (HttpOnly, Secure, SameSite=Lax); frontend doesn't touch it directly
- [ ] Type-safe `User` interface matching backend `MeResponse`
- [ ] Error handling: failed `GET /auth/me` → clear store, redirect to `/`