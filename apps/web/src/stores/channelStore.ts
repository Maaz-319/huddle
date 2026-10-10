import { create } from 'zustand';
import { apiClient } from '@/api/client';
import type { ChannelResponse, ChannelOverrideResponse, ChannelMemberResponse } from '@/types/channel';

interface ChannelStore {
  channelsByServer: Map<string, ChannelResponse[]>;
  currentChannelId: string | null;
  loading: boolean;
  error: string | null;
  
  fetchChannels: (serverId: string) => Promise<void>;
  createChannel: (serverId: string, data: { name: string; isPrivate: boolean }) => Promise<ChannelResponse>;
  updateChannel: (channelId: string, data: { name?: string; isPrivate?: boolean }) => Promise<ChannelResponse>;
  deleteChannel: (channelId: string) => Promise<void>;
  getChannel: (channelId: string) => Promise<ChannelResponse>;
  listOverrides: (channelId: string) => Promise<ChannelOverrideResponse[]>;
  revokeCapability: (channelId: string, role: string, capability: string) => Promise<void>;
  restoreCapability: (channelId: string, role: string, capability: string) => Promise<void>;
  addChannelMember: (channelId: string, userId: string) => Promise<ChannelMemberResponse>;
  removeChannelMember: (channelId: string, userId: string) => Promise<void>;
  setCurrentChannelId: (id: string | null) => void;
}

export const useChannelStore = create<ChannelStore>((set) => ({
  channelsByServer: new Map(),
  currentChannelId: null,
  loading: false,
  error: null,

  fetchChannels: async (serverId) => {
    set({ loading: true, error: null });
    try {
      const channels = await apiClient.get<ChannelResponse[]>(`/servers/${serverId}/channels`);
      set((state) => {
        const newMap = new Map(state.channelsByServer);
        newMap.set(serverId, channels);
        return { channelsByServer: newMap, loading: false };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch channels', loading: false });
    }
  },

  createChannel: async (serverId, data) => {
    const channel = await apiClient.post<ChannelResponse>(`/servers/${serverId}/channels`, data);
    set((state) => {
      const newMap = new Map(state.channelsByServer);
      const existing = newMap.get(serverId) ?? [];
      newMap.set(serverId, [...existing, channel]);
      return { channelsByServer: newMap };
    });
    return channel;
  },

  updateChannel: async (channelId, data) => {
    const channel = await apiClient.patch<ChannelResponse>(`/channels/${channelId}`, data);
    set((state) => {
      const newMap = new Map(state.channelsByServer);
      for (const [serverId, channels] of newMap.entries()) {
        newMap.set(serverId, channels.map((c) => (c.id === channelId ? channel : c)));
      }
      return { channelsByServer: newMap };
    });
    return channel;
  },

  deleteChannel: async (channelId) => {
    await apiClient.delete(`/channels/${channelId}`);
    set((state) => {
      const newMap = new Map(state.channelsByServer);
      for (const [serverId, channels] of newMap.entries()) {
        newMap.set(serverId, channels.filter((c) => c.id !== channelId));
      }
      return { 
        channelsByServer: newMap,
        currentChannelId: state.currentChannelId === channelId ? null : state.currentChannelId,
      };
    });
  },

  getChannel: async (channelId) => {
    return apiClient.get<ChannelResponse>(`/channels/${channelId}`);
  },

  listOverrides: async (channelId) => {
    return apiClient.get<ChannelOverrideResponse[]>(`/channels/${channelId}/overrides`);
  },

  revokeCapability: async (channelId, role, capability) => {
    await apiClient.put(`/channels/${channelId}/overrides/${role}/${capability}`);
  },

  restoreCapability: async (channelId, role, capability) => {
    await apiClient.delete(`/channels/${channelId}/overrides/${role}/${capability}`);
  },

  addChannelMember: async (channelId, userId) => {
    return apiClient.post<ChannelMemberResponse>(`/channels/${channelId}/members`, { userId });
  },

  removeChannelMember: async (channelId, userId) => {
    await apiClient.delete(`/channels/${channelId}/members/${userId}`);
  },

  setCurrentChannelId: (id) => set({ currentChannelId: id }),
}));