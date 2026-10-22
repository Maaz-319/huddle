import { useEffect } from 'react';
import { useNavigate, Outlet } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/components/ui/cn';
import { Toaster } from '@/components/ui';

function LoadingSpinner() {
  return (
    <div className={cn('flex h-dvh w-full items-center justify-center bg-bg-base')}>
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-accent-primary border-t-transparent" />
    </div>
  );
}

/**
 * Auth gate for every /app/* route. The shell itself is decided by the child
 * layout routes: chat routes mount AppShell (three columns / drawers),
 * settings routes mount SettingsShell (full-screen).
 */
export function ProtectedApp() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isHydrated) {
      hydrate().then(() => {
        const freshState = useAuthStore.getState();
        if (!freshState.user) {
          navigate({ to: '/' });
        }
      });
    } else if (!user) {
      navigate({ to: '/' });
    }
  }, [isHydrated, user, hydrate, navigate]);

  if (!isHydrated || !user) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <Outlet />
      {/* Toaster lives at the auth boundary so settings routes get
          notifications too, not only the chat shell. */}
      <Toaster />
    </>
  );
}
