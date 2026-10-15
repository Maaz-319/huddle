import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { AppShell } from './AppShell';
import { cn } from '@/components/ui/cn';

function LoadingSpinner() {
  return (
    <div className={cn('flex h-dvh w-full items-center justify-center bg-bg-base')}>
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-accent-primary border-t-transparent" />
    </div>
  );
}

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

  return <AppShell />;
}