import { createRouter, createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/authStore'
import type { AuthState } from '@/stores/authStore'
import { LandingPage } from '@/components/auth/LandingPage'
import { AuthCallback } from '@/components/auth/AuthCallback'
import { AppShell } from '@/components/layout/AppShell'
import { ServerView } from '@/components/layout/ServerView'
import { ChannelView } from '@/components/layout/ChannelView'
import { ServerSettings } from '@/components/layout/ServerSettings'
import { InvitePreviewPage } from '@/components/invite/InvitePreviewPage'

// Type-safe router context
interface RouterContext {
  auth: AuthState
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
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
  component: () => <AppShell />,
  beforeLoad: async ({ context }: { context: RouterContext }) => {
    const { isHydrated, hydrate } = context.auth
    if (!isHydrated) {
      await hydrate()
    }
    if (!context.auth.user) {
      throw redirect({ to: '/' })
    }
  },
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
  component: () => <ChannelView />,
})

// Server settings - /app/@serverId/settings
const serverSettingsRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/settings',
  component: () => <ServerSettings />,
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
    serverRoute.addChildren([channelRoute, serverSettingsRoute]),
  ])
])

export type Router = typeof routeTree

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: {
    auth: useAuthStore.getState() as AuthState,
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}