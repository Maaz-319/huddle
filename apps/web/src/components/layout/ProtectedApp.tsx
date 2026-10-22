import { useEffect, useRef, useState } from 'react';
import { useNavigate, Outlet } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { consumeReturnTo } from '@/utils/returnTo';
import { cn } from '@/components/ui/cn';
import { Toaster } from '@/components/ui';
import { Button } from '@/components/ui/button';

function LoadingSpinner() {
  return (
    <div className={cn('flex h-dvh w-full items-center justify-center bg-bg-base')}>
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-accent-primary border-t-transparent" />
    </div>
  );
}

function SignInFailed() {
  const navigate = useNavigate();

  return (
    <div className={cn('flex h-dvh w-full flex-col items-center justify-center gap-4 bg-bg-base')}>
      <h1 className="text-xl font-semibold text-text-primary">Sign-in failed</h1>
      <p className="text-sm text-text-secondary">
        GitHub denied the request or the attempt expired.
      </p>
      <Button type="button" onClick={() => navigate({ to: '/' })}>
        Back to home
      </Button>
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
  const returnToTakenRef = useRef(false);
  const [oauthFailed] = useState(
    () => new URLSearchParams(window.location.search).get('error') === 'oauth_failed',
  );

  useEffect(() => {
    if (oauthFailed) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [oauthFailed]);

  useEffect(() => {
    if (oauthFailed) return;

    if (!isHydrated) {
      hydrate().then(() => {
        const freshState = useAuthStore.getState();
        if (!freshState.user) {
          navigate({ to: '/' });
        }
      });
    } else if (!user) {
      navigate({ to: '/' });
    } else if (!returnToTakenRef.current) {
      returnToTakenRef.current = true;
      const target = consumeReturnTo('');
      if (target && target !== '/app') {
        navigate({ to: target, replace: true });
      }
    }
  }, [oauthFailed, isHydrated, user, hydrate, navigate]);

  if (oauthFailed) {
    return <SignInFailed />;
  }

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
