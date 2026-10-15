import { useCallback, useEffect, useRef } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/api/client';
import type { MessageResponse } from '@/types/socket';
import { crypto } from '@/utils/crypto';

interface MessagePageResponse {
  messages: MessageResponse[];
  hasMore: boolean;
}

const MESSAGE_LIMIT = 50;

export function useMessages(channelId: string | null) {
  const { 
    pendingMessages,
    setCurrentChannelId,
    addMessages,
    prependMessages,
    updateMessage,
    getMessages,
    setHasMore,
    getHasMore,
    addPendingMessage,
    resolvePendingMessage,
    rejectPendingMessage,
    onMessageCreate,
    onMessageUpdate,
    onMessageDelete,
    setLastMessageId,
    getLastMessageId,
    setLoading,
    getLoading,
  } = useMessageStore();

  const { emit, on, isConnected } = useSocket();
  const mountedRef = useRef(true);

  // Set current channel
  useEffect(() => {
    setCurrentChannelId(channelId);
    return () => {
      setCurrentChannelId(null);
    };
  }, [channelId, setCurrentChannelId]);

  // Fetch initial history
  const fetchHistory = useCallback(async (options?: { before?: string; after?: string; limit?: number }) => {
    if (!channelId) return;

    setLoading(channelId, true);
    try {
      const params = new URLSearchParams();
      if (options?.before) params.set('before', options.before);
      if (options?.after) params.set('after', options.after);
      if (options?.limit) params.set('limit', String(options.limit));

      const response = await apiClient.get<MessagePageResponse>(
        `/channels/${channelId}/messages?${params.toString()}`
      );

      if (options?.before) {
        // Prepending older messages
        prependMessages(channelId, response.messages);
      } else {
        // Initial load or fetching newer messages
        addMessages(channelId, response.messages);
      }
      setHasMore(channelId, response.hasMore);

      // Update last message ID
      if (response.messages.length > 0) {
        const lastMsg = options?.before ? response.messages[response.messages.length - 1] : response.messages[0];
        setLastMessageId(channelId, lastMsg.id);
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(channelId, false);
    }
  }, [channelId, addMessages, prependMessages, setHasMore, setLastMessageId, setLoading]);

  // Fetch history when the channel changes
  useEffect(() => {
    if (channelId) {
      fetchHistory();
    }
  }, [channelId, fetchHistory]);

  // Send message
  const sendMessage = useCallback(async (content: string) => {
    if (!channelId || !isConnected) return;

    const idempotencyKey = crypto.randomUUID();
    
    // Create optimistic message
    const optimisticMessage: MessageResponse = {
      id: `pending-${idempotencyKey}`,
      channelId,
      authorId: 'current-user', // Will be replaced by server
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      author: {
        id: 'current-user',
        username: 'You',
        avatarUrl: null,
      },
      pending: true,
    };

    addPendingMessage(idempotencyKey, optimisticMessage);

    try {
      const ack = await emit('message_send', { channelId, content });
      // The server will broadcast message_create, which will replace the optimistic message
      // But we also get the ack with the real message ID
      resolvePendingMessage(idempotencyKey, {
        ...optimisticMessage,
        id: ack.messageId,
        createdAt: ack.createdAt,
        pending: false,
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      rejectPendingMessage(idempotencyKey);
      throw error;
    }
  }, [channelId, isConnected, emit, addPendingMessage, resolvePendingMessage, rejectPendingMessage]);

  // Edit message
  const editMessage = useCallback(async (messageId: string, content: string) => {
    if (!channelId || !isConnected) return;

    // Optimistic update
    const messages = getMessages(channelId);
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const optimisticMessage: MessageResponse = {
      ...message,
      content,
      editedAt: new Date().toISOString(),
      pending: true,
    };

    updateMessage(channelId, optimisticMessage);

    try {
      await emit('message_edit', { channelId, messageId, content });
      // Server will broadcast message_update
    } catch (error) {
      console.error('Failed to edit message:', error);
      // Rollback
      updateMessage(channelId, message);
      throw error;
    }
  }, [channelId, isConnected, emit, getMessages, updateMessage]);

  // Delete message
  const deleteMessage = useCallback(async (messageId: string) => {
    if (!channelId || !isConnected) return;

    // Optimistic update - mark as deleted
    const messages = getMessages(channelId);
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const deletedMessage: MessageResponse = {
      ...message,
      content: 'message deleted',
      isDeleted: true,
      pending: true,
    };

    updateMessage(channelId, deletedMessage);

    try {
      await emit('message_delete', { channelId, messageId });
      // Server will broadcast message_delete
    } catch (error) {
      console.error('Failed to delete message:', error);
      // Rollback
      updateMessage(channelId, message);
      throw error;
    }
  }, [channelId, isConnected, emit, getMessages, updateMessage]);

  // Load older messages (pagination)
  const loadOlder = useCallback(async () => {
    if (!channelId) return;
    const hasMore = getHasMore(channelId);
    if (!hasMore) return;

    const firstMessageId = getMessages(channelId)?.[0]?.id;
    if (!firstMessageId) return;

    await fetchHistory({ before: firstMessageId, limit: MESSAGE_LIMIT });
  }, [channelId, fetchHistory, getHasMore, getMessages]);

  // Set up real-time event listeners
  useEffect(() => {
    if (!channelId) return;

    const unsubscribeCreate = on('message_create', (message: MessageResponse) => {
      onMessageCreate(message);
    });

    const unsubscribeUpdate = on('message_update', (message: MessageResponse) => {
      onMessageUpdate(message);
    });

    const unsubscribeDelete = on('message_delete', (payload: { id: string; channelId: string }) => {
      onMessageDelete(payload);
    });

    return () => {
      unsubscribeCreate();
      unsubscribeUpdate();
      unsubscribeDelete();
    };
  }, [channelId, on, onMessageCreate, onMessageUpdate, onMessageDelete]);

  // Catch-up on reconnect
  useEffect(() => {
    if (!channelId || !isConnected) return;

    const lastMessageId = getLastMessageId(channelId);
    if (!lastMessageId) return;

    // Emit catch_up for this channel
    emit('catch_up', {
      channels: [{ channelId, afterMessageId: lastMessageId }],
    }).catch(console.error);
  }, [channelId, isConnected, getLastMessageId, emit]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const messages = getMessages(channelId ?? '');
  const hasMore = getHasMore(channelId ?? '');
  const pending = Array.from(pendingMessages.values()).map(p => p.message);

  return {
    messages,
    pending,
    hasMore,
    loading: channelId ? getLoading(channelId) : false,
    fetchHistory,
    sendMessage,
    editMessage,
    deleteMessage,
    loadOlder,
  };
}

export function useTyping(channelId: string | null) {
  const { emit } = useSocket();
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTyping = useCallback(() => {
    if (!channelId || !emit) return;
    
    emit('typing', { channelId, typing: true }).catch(console.error);
    
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Auto-stop typing after 5 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 5000);
  }, [channelId, emit]);

  const stopTyping = useCallback(() => {
    if (!channelId || !emit) return;
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    emit('typing', { channelId, typing: false }).catch(console.error);
  }, [channelId, emit]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return { startTyping, stopTyping };
}