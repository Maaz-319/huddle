import { Outlet } from '@tanstack/react-router';

/**
 * Full-screen chrome for settings routes — deliberately outside the
 * three-column chat shell so members tables and forms get the whole
 * viewport (Discord-style settings takeover).
 */
export function SettingsShell() {
  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-bg-base">
      <Outlet />
    </div>
  );
}
