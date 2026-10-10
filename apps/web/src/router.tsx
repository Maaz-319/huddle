import { createRouter, createRootRouteWithContext, createRoute, Outlet } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/authStore'
import type { AuthState } from '@/stores/authStore'
import { LandingPage } from '@/components/auth/LandingPage'
import { AuthCallback } from '@/components/auth/AuthCallback'
import { AppShell } from '@/components/layout/AppShell'

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
      throw new Error('UNAUTHORIZED')
    }
  },
})

export const routeTree = rootRoute.addChildren([indexRoute, authCallbackRoute, appRoute])

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