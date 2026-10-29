import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, Outlet } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { useServerStore } from '@/stores/serverStore';
import { useMembershipStore } from '@/stores/membershipStore';
import { useChannelStore } from '@/stores/channelStore';
import { useChannelAccessStore } from '@/access/channelAccess';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/stores/toastStore';
import { apiClient } from '@/api/client';
import { useTranscriptRuntime } from '@/transcript/channelTranscript';
import { ServerList } from './ServerList';
import { ChannelList } from './ChannelList';
import { MemberSidebar } from './MemberSidebar';
import { BottomNav, MobileHeader } from './BottomNav';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/button';
import { Plus, Users } from 'lucide-react';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { ErrorBoundary, FeatureErrorFallback } from '@/components/ui';

function NoServersWelcome({ onCreateServer }: { onCreateServer: () => void }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-6 sm:p-10">
      <section className="w-full max-w-lg text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-primary/10 text-accent-primary">
          <Users className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-text-primary sm:text-3xl">
          Start your first server
        </h1>
        <p className="mx-auto mt-3 max-w-md text-text-secondary">
          Create a space for your people. Add channels, invite members, and start talking.
        </p>
        <Button onClick={onCreateServer} className="mt-6">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create a server
        </Button>
        <p className="mt-5 text-sm text-text-muted">
          Already have an invite? Open its link to join a server.
        </p>
      </section>
    </div>
  );
}

export function AppShell() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const { socket, status, connect, on } = useSocket();
  useTranscriptRuntime();
  const {
    currentServerId,
    servers,
    hasFetched: hasFetchedServers,
    error: serversError,
    fetchServers,
    setCurrentServerId,
  } = useServerStore();
  const { fetchChannels, setCurrentChannelId } = useChannelStore();
  const {
    isChannelListOpen,
    isMemberSidebarOpen,
    isServerListOpen,
    setChannelListOpen,
    setMemberSidebarOpen,
    setActiveMobileTab,
    setCreateServerDialogOpen,
    closeAllDrawers
  } = useUIStore();
  const { isMobile } = useBreakpoints();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string; channelId?: string };
  const showServerPanels = Boolean(currentServerId || params.serverId);
  const membershipUserRef = useRef<string | null>(null);
  const accessProbeStatuses = useChannelAccessStore((state) => state.probeStatusByServer);

  const navigateForAccess = useCallback((serverId: string | null) => {
    if (serverId) {
      void navigate({ to: '/app/$serverId', params: { serverId } });
    } else {
      void navigate({ to: '/app' });
    }
  }, [navigate]);

  // Global error handler
  useGlobalErrorHandler();

  // Initialize auth hydration on mount
  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [isHydrated, hydrate]);

  // Fetch servers on auth
  useEffect(() => {
    if (membershipUserRef.current !== user?.id) {
      useMembershipStore.getState().clear();
      useChannelAccessStore.getState().clear();
      membershipUserRef.current = user?.id ?? null;
    }
    if (user) {
      fetchServers();
    }
  }, [user, fetchServers]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const serverId = useServerStore.getState().currentServerId;
      if (serverId) useMembershipStore.getState().invalidate(serverId);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [user]);

  useEffect(() => {
    if (status !== 'connected') return;
    for (const serverId of Object.keys(useMembershipStore.getState().byServer)) {
      useMembershipStore.getState().invalidate(serverId);
    }
  }, [status]);

  // Sync route params into stores — the route is the source of truth
  useEffect(() => {
    setCurrentServerId(params.serverId ?? null);
    setCurrentChannelId(params.channelId ?? null);
    setActiveMobileTab('messages');
    if (params.serverId) {
      fetchChannels(params.serverId);
    }
  }, [params.serverId, params.channelId, setCurrentServerId, setCurrentChannelId, setActiveMobileTab, fetchChannels]);

  // Connect socket when authenticated
  useEffect(() => {
    if (user && status === 'disconnected') {
      connect();
    }
  }, [user, status, connect]);

  // Set up socket event handlers. Message rows and their catch-up cursor
  // live in the message store's own listeners (useMessages) — advancing
  // lastMessageId here for messages that were never stored (background
  // channels) would skip exactly the gap catch-up exists to fill.
  useEffect(() => {
    if (!socket) return;

    const cleanupViolation = on('policy_violation', () => {
      toast.error('Disconnected', 'Too many requests. Please sign in again.');
      useAuthStore.getState().logout();
    });

    const cleanupChannelAdded = on('channel_added', ({ channelId }) => {
      void useChannelAccessStore.getState().handleChannelAdded(channelId);
    });
    const cleanupMembership = on('membership_changed', ({ serverId }) => {
      if (useServerStore.getState().servers.some((server) => server.id === serverId)) {
        useMembershipStore.getState().invalidate(serverId);
      }
    });
    const cleanupChannelRemoved = on('channel_removed', ({ channelId }) => {
      useChannelAccessStore.getState().handleChannelRemoved(channelId, navigateForAccess);
    });

    return () => {
      cleanupViolation();
      cleanupChannelAdded();
      cleanupMembership();
      cleanupChannelRemoved();
    };
  }, [socket, on, navigateForAccess]);

  // Redirect to first server if on /app with no server selected
  useEffect(() => {
    if (!currentServerId && servers.length > 0 && window.location.pathname === '/app') {
      navigate({ to: `/app/${servers[0].id}` });
    }
  }, [currentServerId, servers, navigate]);

  // Seed drawer defaults for this viewport on every load. Desktop opens the
  // channel list and member list; mobile keeps every drawer closed so the
  // chat is the first thing shown.
  useEffect(() => {
    if (isMobile) {
      closeAllDrawers();
    } else {
      setChannelListOpen(true);
      setMemberSidebarOpen(true);
    }
  }, [isMobile, closeAllDrawers, setChannelListOpen, setMemberSidebarOpen]);

  // Escape closes mobile drawers. The scrim itself is never focusable, so
  // the handler has to live on the window.
  useEffect(() => {
    if (!isMobile) return;
    if (!isChannelListOpen && !isMemberSidebarOpen && !isServerListOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllDrawers();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, isChannelListOpen, isMemberSidebarOpen, isServerListOpen, closeAllDrawers]);

  // Drawer tops/bottoms clear the fixed mobile header (4rem) and bottom nav
  // (4rem + safe-area inset), which env() can't be composed into Tailwind
  // arbitrary values cleanly on every device.
  const drawerClip = {
    top: '4rem',
    bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
  } as const;

  return (
    <div className="h-dvh bg-bg-base flex flex-col overflow-hidden">
      {/* Mobile Header */}
      <MobileHeader />

      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Server rail — fixed drawer on mobile, in-flow column otherwise */}
        <div className={cn(
          'flex-shrink-0 h-full min-w-0 transition-all duration-200',
          isMobile
            ? (isServerListOpen
              ? 'w-16 fixed left-0 bg-bg-raised border-r border-border-subtle shadow-xl z-30 animate-in slide-in-from-left-2'
              : 'w-0 overflow-hidden')
            : 'w-16'
        )}
          style={isMobile && isServerListOpen ? drawerClip : undefined}
        >
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Servers" description="Failed to load your servers" onRetry={() => fetchServers()} />}
            resetKeys={[currentServerId]}
          >
            <ServerList />
          </ErrorBoundary>
        </div>

        {/* Channel list — collapsible everywhere, drawer on mobile. Sits
            beside the server rail only while that rail is open; otherwise it
            hugs the left edge instead of leaving a dead strip. */}
        <div className={cn(
          'flex-shrink-0 h-full min-w-0 transition-all duration-200',
          !showServerPanels
            ? 'hidden'
            : isMobile
            ? (isChannelListOpen
              ? 'w-64 fixed bg-bg-base border-r border-border-subtle shadow-xl z-30 animate-in slide-in-from-left-2'
              : 'w-0 overflow-hidden')
            : (isChannelListOpen ? 'w-64' : 'w-0 overflow-hidden')
        )}
          style={isMobile && isChannelListOpen
            ? { ...drawerClip, left: isServerListOpen ? '4rem' : '0px' }
            : undefined}
        >
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Channels" description="Failed to load channels" onRetry={() => currentServerId && fetchChannels(currentServerId)} />}
            resetKeys={[currentServerId]}
          >
            <ChannelList />
          </ErrorBoundary>
        </div>

        {/* Message pane / settings — center, flex-1 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {Object.entries(accessProbeStatuses).map(([serverId, status]) => {
            const serverName = servers.find((server) => server.id === serverId)?.name ?? 'server';
            return (
              <div
                key={serverId}
                className="flex shrink-0 items-center justify-between gap-3 border-b border-accent-warn/40 bg-accent-warn/10 px-4 py-2 text-sm text-accent-warn"
                role="alert"
              >
                <span>
                  {status === 'checking'
                    ? `Checking access to ${serverName}…`
                    : `Could not verify access to ${serverName}. It remains in your server list.`}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={status === 'checking'}
                  onClick={() => {
                    void useChannelAccessStore.getState().retryServerProbe(
                      serverId,
                      navigateForAccess,
                    );
                  }}
                >
                  {status === 'checking' ? 'Checking…' : 'Retry'}
                </Button>
              </div>
            );
          })}
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Messages" description="Failed to load messages" onRetry={() => params.channelId && apiClient.get(`/channels/${params.channelId}/messages`)} />}
            resetKeys={[params.channelId]}
          >
            {servers.length === 0 && hasFetchedServers && !serversError ? (
              <NoServersWelcome onCreateServer={() => setCreateServerDialogOpen(true)} />
            ) : servers.length === 0 && !hasFetchedServers ? (
              <div className="flex h-full items-center justify-center" role="status" aria-label="Loading servers">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              </div>
            ) : servers.length === 0 && serversError ? (
              <FeatureErrorFallback
                title="Servers"
                description="Could not load your servers"
                onRetry={() => fetchServers()}
              />
            ) : (
              <Outlet />
            )}
          </ErrorBoundary>
        </div>

        {/* Member sidebar — collapsible everywhere, drawer on mobile */}
        <div className={cn(
          'flex-shrink-0 h-full min-w-0 transition-all duration-200',
          !showServerPanels
            ? 'hidden'
            : isMobile
            ? (isMemberSidebarOpen
              ? 'w-64 fixed right-0 bg-bg-base border-l border-border-subtle shadow-xl z-30 animate-in slide-in-from-right-2'
              : 'w-0 overflow-hidden')
            : (isMemberSidebarOpen ? 'w-64' : 'w-0 overflow-hidden')
        )}
          style={isMobile && isMemberSidebarOpen ? drawerClip : undefined}
        >
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Members" description="Failed to load members" onRetry={() => currentServerId && useMembershipStore.getState().refresh(currentServerId)} />}
            resetKeys={[currentServerId]}
          >
            <MemberSidebar />
          </ErrorBoundary>
        </div>
      </div>

      {/* Scrim for mobile drawers — below the drawers (z-30), above content */}
      {(isMobile && (isChannelListOpen || isMemberSidebarOpen || isServerListOpen)) && (
        <button
          className="fixed inset-0 z-20 border-0 bg-black/50 p-0"
          onClick={closeAllDrawers}
          type="button"
          aria-label="Close menu"
        />
      )}

      {/* Bottom Navigation - Mobile only */}
      <BottomNav hasServers={servers.length > 0} />
    </div>
  );
}
