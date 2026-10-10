import { create } from 'zustand';
import type { MessageResponse } from '@/types/socket';

interface PendingMessage {
  idempotencyKey: string;
  message: MessageResponse;
}

interface MessageStore {
  lastMessageIds: Map<string, string>;
  messagesByChannel: Map<string, MessageResponse[]>;
  pendingMessages: Map<string, PendingMessage>;
  hasMoreByChannel: Map<string, boolean>;
  currentChannelId: string | null;

  setCurrentChannelId: (channelId: string | null) => void;
  setLastMessageId: (channelId: string, messageId: string) => void;
  getLastMessageId: (channelId: string) => string | null;
  addMessages: (channelId: string, messages: MessageResponse[]) => void;
  prependMessages: (channelId: string, messages: MessageResponse[]) => void;
  updateMessage: (channelId: string, message: MessageResponse) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  clearChannel: (channelId: string) => void;
  getMessages: (channelId: string) => MessageResponse[];
  setHasMore: (channelId: string, hasMore: boolean) => void;
  getHasMore: (channelId: string) => boolean;
  
  // Optimistic updates
  addPendingMessage: (idempotencyKey: string, message: MessageResponse) => void;
  resolvePendingMessage: (idempotencyKey: string, message: MessageResponse) => void;
  rejectPendingMessage: (idempotencyKey: string) => void;
  getPendingMessage: (idempotencyKey: string) => PendingMessage | undefined;
  
  // Event handlers for real-time updates
  onMessageCreate: (message: MessageResponse) => void;
  onMessageUpdate: (message: MessageResponse) => void;
  onMessageDelete: (payload: { id: string; channelId: string }) => void;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  lastMessageIds: new Map(),
  messagesByChannel: new Map(),
  pendingMessages: new Map(),
  hasMoreByChannel: new Map(),
  currentChannelId: null,

  setCurrentChannelId: (channelId) => set({ currentChannelId: channelId }),

  setLastMessageId: (channelId, messageId) =>
    set((state) => {
      const newMap = new Map(state.lastMessageIds);
      newMap.set(channelId, messageId);
      return { lastMessageIds: newMap };
    }),

  getLastMessageId: (channelId) => {
    return get().lastMessageIds.get(channelId) ?? null;
  },

  addMessages: (channelId, messages) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const newMessages = [...messages, ...existing];
      // Keep only last 100 messages per channel
      const trimmed = newMessages.slice(0, 100);
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, trimmed);

      // Update last message ID
      const lastMsg = messages[0];
      const newLastIds = new Map(state.lastMessageIds);
      if (lastMsg) {
        newLastIds.set(channelId, lastMsg.id);
      }

      return { messagesByChannel: newMap, lastMessageIds: newLastIds };
    }),

  prependMessages: (channelId, messages) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Prepend older messages (they come oldest first from catch_up)
      const newMessages = [...existing, ...messages];
      // Keep only last 100 messages per channel
      const trimmed = newMessages.slice(-100);
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, trimmed);
      return { messagesByChannel: newMap };
    }),

  updateMessage: (channelId, message) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const index = existing.findIndex((m) => m.id === message.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = message;
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, updated);
      return { messagesByChannel: newMap };
    }),

  removeMessage: (channelId, messageId) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const filtered = existing.filter((m) => m.id !== messageId);
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, filtered);
      return { messagesByChannel: newMap };
    }),

  clearChannel: (channelId) =>
    set((state) => {
      const newMessages = new Map(state.messagesByChannel);
      newMessages.delete(channelId);
      const newLastIds = new Map(state.lastMessageIds);
      newLastIds.delete(channelId);
      const newHasMore = new Map(state.hasMoreByChannel);
      newHasMore.delete(channelId);
      return { messagesByChannel: newMessages, lastMessageIds: newLastIds, hasMoreByChannel: newHasMore };
    }),

  getMessages: (channelId) => {
    return get().messagesByChannel.get(channelId) ?? [];
  },

  setHasMore: (channelId, hasMore) =>
    set((state) => {
      const newMap = new Map(state.hasMoreByChannel);
      newMap.set(channelId, hasMore);
      return { hasMoreByChannel: newMap };
    }),

  getHasMore: (channelId) => {
    return get().hasMoreByChannel.get(channelId) ?? true;
  },

  addPendingMessage: (idempotencyKey, message) =>
    set((state) => {
      const newMap = new Map(state.pendingMessages);
      newMap.set(idempotencyKey, { idempotencyKey, message });
      return { pendingMessages: newMap };
    }),

  resolvePendingMessage: (idempotencyKey, message) =>
    set((state) => {
      const pending = state.pendingMessages.get(idempotencyKey);
      if (!pending) return state;
      
      const channelId = pending.message.channelId;
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Replace the optimistic message with the confirmed one
      const index = existing.findIndex((m) => m.id === pending.message.id);
      let updated: MessageResponse[];
      if (index >= 0) {
        updated = [...existing];
        updated[index] = message;
      } else {
        updated = [message, ...existing];
      }
      
      const newMessagesMap = new Map(state.messagesByChannel);
      newMessagesMap.set(channelId, updated.slice(0, 100));
      
      const newPendingMap = new Map(state.pendingMessages);
      newPendingMap.delete(idempotencyKey);
      
      return { messagesByChannel: newMessagesMap, pendingMessages: newPendingMap };
    }),

  rejectPendingMessage: (idempotencyKey) =>
    set((state) => {
      const pending = state.pendingMessages.get(idempotencyKey);
      if (!pending) return state;
      
      const channelId = pending.message.channelId;
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Replace with a "failed to send" indicator or remove
      const filtered = existing.filter((m) => m.id !== pending.message.id);
      
      const newMessagesMap = new Map(state.messagesByChannel);
      newMessagesMap.set(channelId, filtered);
      
      const newPendingMap = new Map(state.pendingMessages);
      newPendingMap.delete(idempotencyKey);
      
      return { messagesByChannel: newMessagesMap, pendingMessages: newPendingMap };
    }),

  getPendingMessage: (idempotencyKey) => {
    return get().pendingMessages.get(idempotencyKey);
  },

  onMessageCreate: (message) =>
    set((state) => {
      // Only add if it's for the current channel
      if (state.currentChannelId !== message.channelId) return state;
      
      const existing = state.messagesByChannel.get(message.channelId) ?? [];
      // Check if already exists (could be from optimistic update)
      if (existing.some((m) => m.id === message.id)) return state;
      
      const updated = [message, ...existing];
      const newMap = new Map(state.messagesByChannel);
      newMap.set(message.channelId, updated.slice(0, 100));
      return { messagesByChannel: newMap };
    }),

  onMessageUpdate: (message) =>
    set((state) => {
      const existing = state.messagesByChannel.get(message.channelId) ?? [];
      const index = existing.findIndex((m) => m.id === message.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = message;
      const newMap = new Map(state.messagesByChannel);
      newMap.set(message.channelId, updated);
      return { messagesByChannel: newMap };
    }),

  onMessageDelete: (payload) =>
    set((state) => {
      const existing = state.messagesByChannel.get(payload.channelId) ?? [];
      // Replace with deleted placeholder
      const index = existing.findIndex((m) => m.id === payload.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = {
        ...updated[index],
        content: 'message deleted',
        isDeleted: true,
      } as MessageResponse;
      
      const newMap = new Map(state.messagesByChannel);
      newMap.set(payload.channelId, updated);
      return { messagesByChannel: newMap };
    }),
}));