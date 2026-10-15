import { useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useUIStore } from '@/stores/uiStore';
import { Toaster } from '@/components/ui';
import { toast } from '@/stores/toastStore';
import { apiClient } from '@/api/client';
import { ServerList } from './ServerList';
import { ChannelList } from './ChannelList';
import { MessagePane } from './MessagePane';
import { MemberSidebar } from './MemberSidebar';
import { BottomNav, MobileHeader } from './BottomNav';
import { cn } from '@/components/ui/cn';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { ErrorBoundary, FeatureErrorFallback } from '@/components/ui';

export function AppShell() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const { socket, status, connect, on, isConnected } = useSocket();
  const setLastMessageId = useMessageStore((s) => s.setLastMessageId);
  const { currentServerId, servers, fetchServers, setCurrentServerId } = useServerStore();
  const { fetchChannels, setCurrentChannelId } = useChannelStore();
  const {
    isChannelListOpen,
    isMemberSidebarOpen,
    isServerListOpen,
    closeAllDrawers
  } = useUIStore();
  const { isMobile, isTablet } = useBreakpoints();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string; channelId?: string };

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

  // Set up socket event handlers
  useEffect(() => {
    if (!socket) return;

    const cleanupCreate = on('message_create', (message) => {
      setLastMessageId(message.channelId, message.id);
    });

    const cleanupUpdate = on('message_update', (message) => {
      setLastMessageId(message.channelId, message.id);
    });

    const cleanupDelete = on('message_delete', () => {});

    const cleanupViolation = on('policy_violation', () => {
      toast.error('Disconnected', 'Too many requests. Please sign in again.');
      useAuthStore.getState().logout();
    });

    return () => {
      cleanupCreate();
      cleanupUpdate();
      cleanupDelete();
      cleanupViolation();
    };
  }, [socket, setLastMessageId, on]);

  // Emit catch_up on reconnect
  useEffect(() => {
    if (!isConnected || !socket) return;

    const channels = Array.from(useMessageStore.getState().lastMessageIds.entries()).map(
      ([channelId, afterMessageId]) => ({ channelId, afterMessageId })
    );

    if (channels.length > 0) {
      socket.emit('catch_up', { channels });
    }
  }, [isConnected, socket]);

  // Redirect to first server if on /app with no server selected
  useEffect(() => {
    if (!currentServerId && servers.length > 0 && window.location.pathname === '/app') {
      navigate({ to: `/app/${servers[0].id}` });
    }
  }, [currentServerId, servers, navigate]);

  return (
    <div className="h-dvh bg-bg-base flex flex-col overflow-hidden">
      {/* Mobile Header */}
      <MobileHeader />

      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Server List - Always visible on desktop/tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 z-30',
          'w-16',
          isMobile && !isServerListOpen && '-translate-x-full',
          isMobile && isServerListOpen && 'translate-x-0 fixed top-16 bottom-16 left-0 bg-bg-raised border-r border-border-subtle shadow-xl z-30',
        )}>
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Servers" description="Failed to load your servers" onRetry={() => fetchServers()} />}
            resetKeys={[currentServerId]}
          >
            <ServerList />
          </ErrorBoundary>
        </div>

        {/* Channel List - Collapsible drawer on tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 z-20',
          'w-64',
          isTablet && !isChannelListOpen && 'w-0 overflow-hidden',
          isMobile && !isChannelListOpen && '-translate-x-full fixed top-16 bottom-16 left-16 w-64 bg-bg-base border-r border-border-subtle shadow-xl z-20',
          isMobile && isChannelListOpen && 'translate-x-0 fixed top-16 bottom-16 left-16 w-64 bg-bg-base border-r border-border-subtle shadow-xl z-20',
        )}>
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Channels" description="Failed to load channels" onRetry={() => currentServerId && fetchChannels(currentServerId)} />}
            resetKeys={[currentServerId]}
          >
            <ChannelList />
          </ErrorBoundary>
        </div>

        {/* Message Pane - Center, flex-1 */}
        <div className={cn(
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          'lg:max-w-3xl lg:mx-auto'
        )}>
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Messages" description="Failed to load messages" onRetry={() => params.channelId && apiClient.get(`/channels/${params.channelId}/messages`)} />}
            resetKeys={[params.channelId]}
          >
            <MessagePane />
          </ErrorBoundary>
        </div>

        {/* Member Sidebar - Collapsible drawer on tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 z-10',
          'w-64',
          isTablet && !isMemberSidebarOpen && 'w-0 overflow-hidden',
          isMobile && !isMemberSidebarOpen && 'translate-x-full fixed top-16 bottom-16 right-0 w-64 bg-bg-base border-l border-border-subtle shadow-xl z-10',
          isMobile && isMemberSidebarOpen && 'translate-x-0 fixed top-16 bottom-16 right-0 w-64 bg-bg-base border-l border-border-subtle shadow-xl z-10',
        )}>
          <ErrorBoundary
            fallback={<FeatureErrorFallback title="Members" description="Failed to load members" onRetry={() => currentServerId && useChannelStore.getState().listServerMembers(currentServerId)} />}
            resetKeys={[currentServerId]}
          >
            <MemberSidebar />
          </ErrorBoundary>
        </div>
      </div>

      {/* Overlay for mobile drawers */}
      {(isMobile && (isChannelListOpen || isMemberSidebarOpen || isServerListOpen)) && (
        <div
          className="fixed inset-0 bg-black/50 z-15 lg:hidden"
          onClick={closeAllDrawers}
          aria-hidden="true"
        />
      )}

      {/* Bottom Navigation - Mobile only */}
      <BottomNav />

      <Toaster />
    </div>
  );
}
