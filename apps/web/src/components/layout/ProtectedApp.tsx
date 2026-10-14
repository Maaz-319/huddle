import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { AppShell } from './AppShell';
import { cn } from '@/components/ui/cn';

function LoadingSpinner() {
  return (
    <div className={cn('flex h-screen w-screen items-center justify-center bg-background')}>
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
    </div>
  );
}

export function ProtectedApp() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('[ProtectedApp] Effect running:', { isHydrated, user });
    if (!isHydrated) {
      hydrate().then(() => {
        const freshState = useAuthStore.getState();
        console.log('[ProtectedApp] After hydrate:', freshState);
        if (!freshState.user) {
          console.log('[ProtectedApp] No user, redirecting to /');
          navigate({ to: '/' });
        } else {
          console.log('[ProtectedApp] User found, staying on /app');
        }
      });
    } else if (!user) {
      console.log('[ProtectedApp] Already hydrated but no user, redirecting');
      navigate({ to: '/' });
    }
  }, [isHydrated, user, hydrate, navigate]);

  if (!isHydrated || !user) {
    return <LoadingSpinner />;
  }

  return <AppShell />;
}