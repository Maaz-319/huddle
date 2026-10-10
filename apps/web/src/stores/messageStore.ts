import { create } from 'zustand';
import type { MessageResponse } from '@/types/socket';

interface MessageStore {
  lastMessageIds: Map<string, string>;
  messagesByChannel: Map<string, MessageResponse[]>;
  
  setLastMessageId: (channelId: string, messageId: string) => void;
  getLastMessageId: (channelId: string) => string | null;
  addMessages: (channelId: string, messages: MessageResponse[]) => void;
  updateMessage: (channelId: string, message: MessageResponse) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  clearChannel: (channelId: string) => void;
  getMessages: (channelId: string) => MessageResponse[];
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  lastMessageIds: new Map(),
  messagesByChannel: new Map(),

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
      return { messagesByChannel: newMessages, lastMessageIds: newLastIds };
    }),

  getMessages: (channelId) => {
    return get().messagesByChannel.get(channelId) ?? [];
  },
}));