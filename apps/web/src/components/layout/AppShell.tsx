import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useUIStore } from '@/stores/uiStore';
import { Toaster } from '@/components/ui';
import { toast } from '@/stores/toastStore';
import { ServerList } from './ServerList';
import { ChannelList } from './ChannelList';
import { MessagePane } from './MessagePane';
import { MemberSidebar } from './MemberSidebar';
import { BottomNav, MobileHeader } from './BottomNav';
import { cn } from '@/components/ui/cn';

export function AppShell() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const { socket, status, connect, on, isConnected } = useSocket();
  const setLastMessageId = useMessageStore((s) => s.setLastMessageId);
  const { currentServerId, servers, fetchServers } = useServerStore();
  const { 
    isChannelListOpen, 
    isMemberSidebarOpen,
    isServerListOpen,
    closeAllDrawers
  } = useUIStore();
  const navigate = useNavigate();

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

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const isTablet = typeof window !== 'undefined' && window.innerWidth >= 640 && window.innerWidth < 1024;

  return (
    <div className="min-h-screen bg-bg-base flex flex-col relative">
      {/* Mobile Header */}
      <MobileHeader />
      
      <div className="flex-1 flex overflow-hidden lg:pt-0">
        {/* Server List - Always visible on desktop/tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 transition-transform duration-200 ease-in-out z-30',
          'w-16 lg:w-16',
          isMobile && !isServerListOpen && '-translate-x-full',
          isMobile && isServerListOpen && 'translate-x-0 fixed inset-y-0 left-0 bg-bg-raised border-r border-border-subtle shadow-xl',
          isTablet && 'w-14'
        )}>
          <ServerList />
        </div>

        {/* Channel List - Collapsible drawer on tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 transition-all duration-200 ease-in-out z-20',
          'w-64 lg:w-64',
          isTablet && !isChannelListOpen && 'w-0 overflow-hidden',
          isMobile && !isChannelListOpen && '-translate-x-full fixed inset-y-0 left-16 w-64 bg-bg-base border-r border-border-subtle shadow-xl z-20',
          isMobile && isChannelListOpen && 'translate-x-0 fixed inset-y-0 left-16 w-64 bg-bg-base border-r border-border-subtle shadow-xl z-20',
        )}>
          <ChannelList />
        </div>

        {/* Message Pane - Center, flex-1 */}
        <div className={cn(
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          'lg:max-w-3xl lg:mx-auto lg:w-full'
        )}>
          <MessagePane />
        </div>

        {/* Member Sidebar - Collapsible drawer on tablet, modal on mobile */}
        <div className={cn(
          'flex-shrink-0 transition-all duration-200 ease-in-out z-10',
          'w-64 lg:w-64',
          isTablet && !isMemberSidebarOpen && 'w-0 overflow-hidden',
          isMobile && !isMemberSidebarOpen && 'translate-x-full fixed inset-y-0 right-0 w-64 bg-bg-base border-l border-border-subtle shadow-xl z-10',
          isMobile && isMemberSidebarOpen && 'translate-x-0 fixed inset-y-0 right-0 w-64 bg-bg-base border-l border-border-subtle shadow-xl z-10',
        )}>
          <MemberSidebar />
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