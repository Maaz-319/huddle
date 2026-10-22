import { useEffect, useRef } from 'react';
import { useNavigate, useParams, Outlet } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/stores/toastStore';
import { apiClient, isApiError } from '@/api/client';
import { applyCatchUpReply } from '@/hooks/useMessages';
import { ServerList } from './ServerList';
import { ChannelList } from './ChannelList';
import { MemberSidebar } from './MemberSidebar';
import { BottomNav, MobileHeader } from './BottomNav';
import { cn } from '@/components/ui/cn';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { ErrorBoundary, FeatureErrorFallback } from '@/components/ui';

export function AppShell() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const { socket, status, connect, emit, on, isConnected } = useSocket();
  const { currentServerId, servers, fetchServers, setCurrentServerId } = useServerStore();
  const { fetchChannels, setCurrentChannelId } = useChannelStore();
  const {
    isChannelListOpen,
    isMemberSidebarOpen,
    isServerListOpen,
    setChannelListOpen,
    setMemberSidebarOpen,
    closeAllDrawers
  } = useUIStore();
  const { isMobile } = useBreakpoints();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string; channelId?: string };
  const probingServersRef = useRef<Set<string>>(new Set());

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
    if (user) {
      fetchServers();
    }
  }, [user, fetchServers]);

  // Sync route params into stores — the route is the source of truth
  useEffect(() => {
    setCurrentServerId(params.serverId ?? null);
    setCurrentChannelId(params.channelId ?? null);
    if (params.serverId) {
      fetchChannels(params.serverId);
    }
  }, [params.serverId, params.channelId, setCurrentServerId, setCurrentChannelId, fetchChannels]);

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

    const channelStore = useChannelStore.getState();
    const cleanupChannelAdded = on('channel_added', ({ channelId }) => {
      channelStore.onChannelAdded(channelId);
    });
    const cleanupChannelRemoved = on('channel_removed', ({ channelId }) => {
      const emptiedServerId = (() => {
        for (const [sid, channels] of useChannelStore.getState().channelsByServer.entries()) {
          if (channels.some((c) => c.id === channelId)) {
            return channels.length === 1 ? sid : null;
          }
        }
        return null;
      })();

      channelStore.onChannelRemoved(channelId);

      if (!emptiedServerId || probingServersRef.current.has(emptiedServerId)) return;
      probingServersRef.current.add(emptiedServerId);

      void (async () => {
        try {
          await apiClient.get(`/servers/${emptiedServerId}`);
        } catch (error) {
          if (
            isApiError(error) &&
            (error.status === 404 || error.status === 403)
          ) {
            const wasActive =
              useServerStore.getState().currentServerId === emptiedServerId;
            useServerStore.getState().removeServer(emptiedServerId);
            if (wasActive) {
              toast.error(
                'Server unavailable',
                'You no longer have access to this server.',
              );
              navigate({ to: '/app' });
            }
          }
        } finally {
          probingServersRef.current.delete(emptiedServerId);
        }
      })();
    });

    return () => {
      cleanupViolation();
      cleanupChannelAdded();
      cleanupChannelRemoved();
    };
  }, [socket, on, navigate]);

  // Catch up on reconnect: every channel the client holds state for, in one
  // frame (not one per channel — that's the reconnection storm the frame
  // exists to avoid). The reply lives only in the ack, so it has to be
  // awaited and applied; a fire-and-forget emit fetched nothing.
  useEffect(() => {
    if (!isConnected) return;

    const channels = Array.from(useMessageStore.getState().lastMessageIds.entries()).map(
      ([channelId, afterMessageId]) => ({ channelId, afterMessageId })
    );
    if (channels.length === 0) return;

    void (async () => {
      try {
        const reply = await emit('catch_up', { channels });
        await applyCatchUpReply(reply);
      } catch (error) {
        console.error('Catch-up failed:', error);
      }
    })();
  }, [isConnected, emit]);

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
          isMobile
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
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Messages" description="Failed to load messages" onRetry={() => params.channelId && apiClient.get(`/channels/${params.channelId}/messages`)} />}
            resetKeys={[params.channelId]}
          >
            <Outlet />
          </ErrorBoundary>
        </div>

        {/* Member sidebar — collapsible everywhere, drawer on mobile */}
        <div className={cn(
          'flex-shrink-0 h-full min-w-0 transition-all duration-200',
          isMobile
            ? (isMemberSidebarOpen
              ? 'w-64 fixed right-0 bg-bg-base border-l border-border-subtle shadow-xl z-30 animate-in slide-in-from-right-2'
              : 'w-0 overflow-hidden')
            : (isMemberSidebarOpen ? 'w-64' : 'w-0 overflow-hidden')
        )}
          style={isMobile && isMemberSidebarOpen ? drawerClip : undefined}
        >
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Members" description="Failed to load members" onRetry={() => currentServerId && useChannelStore.getState().listServerMembers(currentServerId)} />}
            resetKeys={[currentServerId]}
          >
            <MemberSidebar />
          </ErrorBoundary>
        </div>
      </div>

      {/* Scrim for mobile drawers — below the drawers (z-30), above content */}
      {(isMobile && (isChannelListOpen || isMemberSidebarOpen || isServerListOpen)) && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={closeAllDrawers}
          role="button"
          tabIndex={-1}
          aria-label="Close menu"
        />
      )}

      {/* Bottom Navigation - Mobile only */}
      <BottomNav />
    </div>
  );
}
