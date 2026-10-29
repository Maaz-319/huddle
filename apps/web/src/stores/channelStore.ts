import { create } from 'zustand';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { ChannelResponse, ChannelOverrideResponse, ChannelMemberResponse, ServerMemberResponse } from '@/types/channel';

interface ChannelStore {
  channelsByServer: Map<string, ChannelResponse[]>;
  verifiedChannelIds: Set<string>;
  permissionUserId: string | null;
  currentChannelId: string | null;
  loading: boolean;
  error: string | null;
  
  fetchChannels: (serverId: string) => Promise<void>;
  createChannel: (serverId: string, data: { name: string; isPrivate: boolean }) => Promise<ChannelResponse>;
  updateChannel: (channelId: string, data: { name?: string; isPrivate?: boolean }) => Promise<ChannelResponse>;
  deleteChannel: (channelId: string) => Promise<void>;
  getChannel: (channelId: string) => Promise<ChannelResponse>;
  listOverrides: (channelId: string) => Promise<ChannelOverrideResponse[]>;
  listChannelMembers: (channelId: string) => Promise<ChannelMemberResponse[]>;
  listServerMembers: (serverId: string) => Promise<ServerMemberResponse[]>;
  revokeCapability: (channelId: string, role: string, capability: string) => Promise<void>;
  restoreCapability: (channelId: string, role: string, capability: string) => Promise<void>;
  addChannelMember: (channelId: string, userId: string) => Promise<ChannelMemberResponse>;
  removeChannelMember: (channelId: string, userId: string) => Promise<void>;
  setCurrentChannelId: (id: string | null) => void;
  clear: () => void;
}

const fetchVersions = new Map<string, number>();

export const useChannelStore = create<ChannelStore>((set) => ({
  channelsByServer: new Map(),
  verifiedChannelIds: new Set(),
  permissionUserId: null,
  currentChannelId: null,
  loading: false,
  error: null,

  fetchChannels: async (serverId) => {
    const version = (fetchVersions.get(serverId) ?? 0) + 1;
    const permissionUserId = useAuthStore.getState().user?.id ?? null;
    fetchVersions.set(serverId, version);
    set((state) => {
      const sameUser = state.permissionUserId === permissionUserId;
      const channelsByServer = sameUser ? state.channelsByServer : new Map();
      const verifiedChannelIds = sameUser ? new Set(state.verifiedChannelIds) : new Set<string>();
      for (const channel of channelsByServer.get(serverId) ?? []) {
        verifiedChannelIds.delete(channel.id);
      }
      return { channelsByServer, loading: true, error: null, verifiedChannelIds, permissionUserId };
    });
    try {
      const channels = await apiClient.get<ChannelResponse[]>(`/servers/${serverId}/channels`);
      if (fetchVersions.get(serverId) !== version || useAuthStore.getState().user?.id !== permissionUserId) return;
      set((state) => {
        const newMap = new Map(state.channelsByServer);
        newMap.set(serverId, channels);
        const verifiedChannelIds = new Set(state.verifiedChannelIds);
        for (const channel of channels) verifiedChannelIds.add(channel.id);
        return { channelsByServer: newMap, verifiedChannelIds, loading: false };
      });
    } catch (error) {
      if (fetchVersions.get(serverId) !== version || useAuthStore.getState().user?.id !== permissionUserId) return;
      set({ error: error instanceof Error ? error.message : 'Failed to fetch channels', loading: false });
    }
  },

  createChannel: async (serverId, data) => {
    const permissionUserId = useAuthStore.getState().user?.id ?? null;
    const channel = await apiClient.post<ChannelResponse>(`/servers/${serverId}/channels`, data);
    if (useAuthStore.getState().user?.id !== permissionUserId) return channel;
    set((state) => {
      const sameUser = state.permissionUserId === permissionUserId;
      const newMap = sameUser ? new Map(state.channelsByServer) : new Map<string, ChannelResponse[]>();
      const existing = newMap.get(serverId) ?? [];
      const verifiedChannelIds = sameUser ? new Set(state.verifiedChannelIds) : new Set<string>();
      if (channel.myCapabilities.includes('view')) {
        newMap.set(serverId, [...existing, channel]);
        verifiedChannelIds.add(channel.id);
      }
      return { channelsByServer: newMap, verifiedChannelIds, permissionUserId };
    });
    return channel;
  },

  updateChannel: async (channelId, data) => {
    const permissionUserId = useAuthStore.getState().user?.id ?? null;
    const channel = await apiClient.patch<ChannelResponse>(`/channels/${channelId}`, data);
    if (useAuthStore.getState().user?.id !== permissionUserId) return channel;
    set((state) => {
      const sameUser = state.permissionUserId === permissionUserId;
      const newMap = sameUser ? new Map(state.channelsByServer) : new Map<string, ChannelResponse[]>();
      for (const [serverId, channels] of newMap.entries()) {
        if (channel.myCapabilities.includes('view')) {
          newMap.set(serverId, channels.map((c) => (c.id === channelId ? channel : c)));
        } else {
          newMap.set(serverId, channels.filter((c) => c.id !== channelId));
        }
      }
      const verifiedChannelIds = sameUser ? new Set(state.verifiedChannelIds) : new Set<string>();
      if (channel.myCapabilities.includes('view')) verifiedChannelIds.add(channel.id);
      else verifiedChannelIds.delete(channel.id);
      return { channelsByServer: newMap, verifiedChannelIds, permissionUserId };
    });
    return channel;
  },

  deleteChannel: async (channelId) => {
    await apiClient.delete(`/channels/${channelId}`);
    set((state) => {
      const newMap = new Map(state.channelsByServer);
      const verifiedChannelIds = new Set(state.verifiedChannelIds);
      verifiedChannelIds.delete(channelId);
      for (const [serverId, channels] of newMap.entries()) {
        newMap.set(serverId, channels.filter((c) => c.id !== channelId));
      }
      return { 
        channelsByServer: newMap,
        verifiedChannelIds,
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

  listChannelMembers: async (channelId) => {
    return apiClient.get<ChannelMemberResponse[]>(`/channels/${channelId}/members`);
  },

  listServerMembers: async (serverId) => {
    return apiClient.get<ServerMemberResponse[]>(`/servers/${serverId}/members`);
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
  clear: () => {
    for (const [serverId, version] of fetchVersions) {
      fetchVersions.set(serverId, version + 1);
    }
    set({
      channelsByServer: new Map(),
      verifiedChannelIds: new Set(),
      permissionUserId: null,
      currentChannelId: null,
      loading: false,
      error: null,
    });
  },
}));
