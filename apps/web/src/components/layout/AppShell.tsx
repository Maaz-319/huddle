import { Outlet } from '@tanstack/react-router'

export function AppShell() {
  return (
    <div className="min-h-screen bg-bg-base">
      <Outlet />
    </div>
  )
}