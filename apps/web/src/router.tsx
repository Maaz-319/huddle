import { createRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { LandingPage } from '@/components/auth/LandingPage'
import { AuthCallback } from '@/components/auth/AuthCallback'
import { ProtectedApp } from '@/components/layout/ProtectedApp'
import { ServerView } from '@/components/layout/ServerView'
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

// Protected app routes - /app/*
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: () => <ProtectedApp />,
})

// Server view - /app/@serverId
const serverRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/$serverId',
  component: () => <ServerView />,
})

// Channel view - /app/@serverId/@channelId
const channelRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/$channelId',
  component: () => <MessagePane />,
})

// Server settings - /app/@serverId/settings
const serverSettingsRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/settings',
  component: () => <ServerSettings />,
})

// User settings - /app/settings
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: () => <SettingsPage />,
})

// Redirect /app to first server or show empty state
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
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
    appIndexRoute,
    settingsRoute,
    serverRoute.addChildren([channelRoute, serverSettingsRoute]),
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