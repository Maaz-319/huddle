import { createRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { LandingPage } from '@/components/auth/LandingPage'
import { AuthCallback } from '@/components/auth/AuthCallback'
import { ProtectedApp } from '@/components/layout/ProtectedApp'
import { AppShell } from '@/components/layout/AppShell'
import { SettingsShell } from '@/components/layout/SettingsShell'
import { ServerView } from '@/components/layout/ServerView'
import { ServerHome } from '@/components/layout/ServerHome'
import { ServerSettings } from '@/components/layout/ServerSettings'
import { InvitePreviewPage } from '@/components/invite/InvitePreviewPage'
import { MessagePane } from '@/components/chat/MessagePane'
import { SettingsPage } from '@/components/settings/SettingsPage'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

// Landing page - /
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <LandingPage />,
})

// Auth callback - /auth/callback
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: () => <AuthCallback />,
})

// Invite preview - /invite/:code (public)
const invitePreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$code',
  component: () => <InvitePreviewPage />,
})

// Protected app routes - /app/* (auth gate only; shell chosen by children)
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: () => <ProtectedApp />,
})

// Chat shell - three columns on desktop, drawers on mobile
const appShellRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'shell',
  component: () => <AppShell />,
})

// Settings shell - full-screen, outside the chat columns
const settingsShellRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'settings',
  component: () => <SettingsShell />,
})

// Server view - /app/$serverId
const serverRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/$serverId',
  component: () => <ServerView />,
})

// Channel view - /app/$serverId/$channelId
const channelRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/$channelId',
  component: () => <MessagePane />,
})

// Server home - /app/$serverId (no channel selected)
const serverIndexRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/',
  component: () => <ServerHome />,
})

// Server settings - /app/$serverId/settings (full-screen)
const serverSettingsRoute = createRoute({
  getParentRoute: () => settingsShellRoute,
  path: '/$serverId/settings',
  component: () => <ServerSettings />,
})

// User settings - /app/settings (full-screen)
const userSettingsRoute = createRoute({
  getParentRoute: () => settingsShellRoute,
  path: '/settings',
  component: () => <SettingsPage />,
})

// Redirect /app to first server or show empty state
const appIndexRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/',
  beforeLoad: () => {
    // This will be handled by AppShell effect
  },
  component: () => <Outlet />,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  authCallbackRoute,
  invitePreviewRoute,
  appRoute.addChildren([
    appShellRoute.addChildren([
      appIndexRoute,
      serverRoute.addChildren([serverIndexRoute, channelRoute]),
    ]),
    settingsShellRoute.addChildren([userSettingsRoute, serverSettingsRoute]),
  ])
])

export type Router = typeof routeTree

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
