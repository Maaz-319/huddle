import { useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { Toaster } from '@/components/ui';
import { useMessageStore } from '@/stores/messageStore';
import { toast } from '@/stores/toastStore';

export function AppShell() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const { socket, status, connect, on, isConnected } = useSocket();
  const setLastMessageId = useMessageStore((s) => s.setLastMessageId);

  // Initialize auth hydration on mount
  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [isHydrated, hydrate]);

  // Connect socket when authenticated
  useEffect(() => {
    if (user && status === 'disconnected') {
      connect();
    }
  }, [user, status, connect]);

  // Set up socket event handlers
  useEffect(() => {
    if (!socket) return;

    // Handle incoming messages to update last message IDs for catch_up
    const cleanupCreate = on('message_create', (message) => {
      setLastMessageId(message.channelId, message.id);
    });

    const cleanupUpdate = on('message_update', (message) => {
      setLastMessageId(message.channelId, message.id);
    });

    const cleanupDelete = on('message_delete', () => {
      // Keep last message ID as is, or update if needed
    });

    // Handle policy violation - force re-auth
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

    // Get all channels we have message history for
    const channels = Array.from(useMessageStore.getState().lastMessageIds.entries()).map(
      ([channelId, afterMessageId]) => ({ channelId, afterMessageId })
    );

    if (channels.length > 0) {
      socket.emit('catch_up', { channels });
    }
  }, [isConnected, socket]);

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <Outlet />
      <Toaster />
    </div>
  );
}