import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import { useAuthStore } from '@/stores/authStore';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/api/client';
import { authApi } from '@/api/auth';
import type { MessageResponse, CatchUpAck } from '@/types/socket';
import { crypto } from '@/utils/crypto';

interface MessagePageResponse {
  messages: MessageResponse[];
  hasMore: boolean;
}

const MESSAGE_LIMIT = 50;

/**
 * Loads a channel's history outside the hook — the catch-up path needs the
 * same fetch for a truncated channel's fresh reload, and it must not depend
 * on which component happens to be mounted.
 */
export async function fetchChannelHistory(
  channelId: string,
  options?: { before?: string; after?: string; limit?: number },
): Promise<void> {
  const store = useMessageStore.getState();
  store.setLoading(channelId, true);
  try {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.after) params.set('after', options.after);
    if (options?.limit) params.set('limit', String(options.limit));

    const response = await apiClient.get<MessagePageResponse>(
      `/channels/${channelId}/messages?${params.toString()}`,
    );

    if (options?.before) {
      // Older page → prepends above what we hold.
      store.prependMessages(channelId, response.messages);
    } else {
      // Initial load or newer window → merges in ascending order.
      store.addMessages(channelId, response.messages);
    }
    store.setHasMore(channelId, response.hasMore);
  } catch (error) {
    console.error('Failed to fetch history:', error);
  } finally {
    store.setLoading(channelId, false);
  }
}

/**
 * Applies a consumed `catch_up` ack — the reply rides in the ack, never as a
 * broadcast, so emitting without awaiting it fetched nothing at all.
 *
 * `truncated: true` means the reply is not the whole gap; rendering it would
 * silently show a hole as continuity. The stale transcript is dropped and,
 * for the channel on screen, reloaded fresh.
 */
export async function applyCatchUpReply(reply: CatchUpAck): Promise<void> {
  if (!reply || reply.error || !Array.isArray(reply.channels)) return;

  const store = useMessageStore.getState();
  for (const entry of reply.channels) {
    if (entry.truncated) {
      const currentChannelId = store.currentChannelId;
      store.clearChannel(entry.channelId);
      if (entry.channelId === currentChannelId) {
        await fetchChannelHistory(entry.channelId);
      }
    } else if (entry.messages.length > 0) {
      store.addMessages(entry.channelId, entry.messages);
    }
  }
}

export function useMessages(channelId: string | null) {
  const {
    setCurrentChannelId,
    updateMessage,
    getMessages,
    getHasMore,
    addPendingMessage,
    resolvePendingMessage,
    rejectPendingMessage,
    removeMessage,
    onMessageCreate,
    onMessageUpdate,
    onMessageDelete,
    getLastMessageId,
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

  // Fetch initial history (module-level so catch-up can reuse it)
  const fetchHistory = useCallback(
    (options?: { before?: string; after?: string; limit?: number }) =>
      channelId ? fetchChannelHistory(channelId, options) : Promise.resolve(),
    [channelId],
  );

  // Fetch history when the channel changes
  useEffect(() => {
    if (channelId) {
      fetchHistory();
    }
  }, [channelId, fetchHistory]);

  // Send message
  const sendMessage = useCallback(async (content: string) => {
    const user = useAuthStore.getState().user;
    if (!channelId || !isConnected || !user) return;

    const idempotencyKey = crypto.randomUUID();

    // Optimistic message, authored by the real signed-in user: the server
    // broadcast will confirm it under the same id, and a placeholder author
    // here would survive as a permanent lie whenever the update raced it.
    const optimisticMessage: MessageResponse = {
      id: `pending-${idempotencyKey}`,
      channelId,
      authorId: user.id,
      author: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      isDeleted: false,
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

  // Retry a failed send: drop the failed row, then send the same content fresh.
  const retryMessage = useCallback(async (messageId: string) => {
    if (!channelId) return;
    const message = getMessages(channelId).find((m) => m.id === messageId);
    if (!message || !message.failed || !message.content) return;
    removeMessage(channelId, messageId);
    await sendMessage(message.content);
  }, [channelId, getMessages, removeMessage, sendMessage]);

  // Discard a failed send
  const discardFailedMessage = useCallback((messageId: string) => {
    if (!channelId) return;
    removeMessage(channelId, messageId);
  }, [channelId, removeMessage]);

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
    if (!firstMessageId || firstMessageId.startsWith('pending-')) return;

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

  // Catch up when the channel opens or the socket reconnects: the reply
  // lives in the ack, so it must be awaited and applied — the old
  // fire-and-forget emit fetched nothing.
  useEffect(() => {
    if (!channelId || !isConnected) return;

    const lastMessageId = getLastMessageId(channelId);
    if (!lastMessageId) return;

    void (async () => {
      try {
        const reply = await emit('catch_up', {
          channels: [{ channelId, afterMessageId: lastMessageId }],
        });
        await applyCatchUpReply(reply);
      } catch (error) {
        console.error('Catch-up failed:', error);
      }
    })();
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

  return {
    messages,
    hasMore,
    loading: channelId ? getLoading(channelId) : false,
    fetchHistory,
    sendMessage,
    retryMessage,
    discardFailedMessage,
    editMessage,
    deleteMessage,
    loadOlder,
  };
}

const TYPING_TTL_MS = 7000;

export function useTyping(channelId: string | null) {
  const { emit, on } = useSocket();
  const user = useAuthStore((s) => s.user);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiriesRef = useRef<Map<string, number>>(new Map());
  const usernamesRef = useRef<Map<string, string>>(new Map());
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);

  const pruneAndPublish = useCallback(() => {
    const now = Date.now();
    for (const [id, expiry] of expiriesRef.current) {
      if (expiry <= now) {
        expiriesRef.current.delete(id);
      }
    }
    const next = Array.from(expiriesRef.current.keys()).map(
      (id) => usernamesRef.current.get(id) ?? 'Someone'
    );
    setTypingUsernames((prev) =>
      prev.length === next.length && prev.every((name, i) => name === next[i])
        ? prev
        : next
    );
  }, []);

  // Listen for others typing in this channel
  useEffect(() => {
    if (!channelId) return;

    const unsubscribe = on('typing', ({ channelId: eventChannelId, userId }) => {
      if (eventChannelId !== channelId) return;
      // The server debounces repeats; a fresh event extends the window.
      expiriesRef.current.set(userId, Date.now() + TYPING_TTL_MS);
      pruneAndPublish();

      if (userId !== user?.id && !usernamesRef.current.has(userId)) {
        authApi
          .getUsers([userId])
          .then((users) => {
            if (users[0]) {
              usernamesRef.current.set(userId, users[0].username);
              pruneAndPublish();
            }
          })
          .catch(() => {
            // 'Someone' fallback already published
          });
      } else if (userId === user?.id) {
        // Never show the local user's own typing back to them
        expiriesRef.current.delete(userId);
        pruneAndPublish();
      }
    });

    return unsubscribe;
  }, [channelId, on, user?.id, pruneAndPublish]);

  // Sweep expired entries
  useEffect(() => {
    if (!channelId) return;
    const interval = setInterval(pruneAndPublish, 1000);
    return () => clearInterval(interval);
  }, [channelId, pruneAndPublish]);

  // Clear when leaving the channel
  useEffect(() => {
    const expiries = expiriesRef.current;
    return () => {
      expiries.clear();
      setTypingUsernames([]);
    };
  }, [channelId]);

  // startTyping's timeout calls stopTyping without a TDZ dependency cycle.
  const stopTypingRef = useRef<() => void>(() => {});

  const startTyping = useCallback(() => {
    if (!channelId || !emit) return;

    emit('typing', { channelId, typing: true }).catch(console.error);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Auto-stop typing after 5 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      stopTypingRef.current();
    }, 5000);
  }, [channelId, emit]);

  const stopTyping = useCallback(() => {
    if (!channelId || !emit) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    emit('typing', { channelId, typing: false }).catch(console.error);
  }, [channelId, emit]);

  useEffect(() => {
    stopTypingRef.current = stopTyping;
  }, [stopTyping]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return { startTyping, stopTyping, typingUsernames };
}
