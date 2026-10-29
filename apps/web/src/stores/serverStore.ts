import { create } from 'zustand';
import { apiClient } from '@/api/client';
import type { ServerResponse, InviteResponse } from '@/types/server';
import type { ServerRole } from '@/types/channel';

interface ServerStore {
  servers: ServerResponse[];
  currentServerId: string | null;
  loading: boolean;
  hasFetched: boolean;
  error: string | null;
  myRolesByServer: Record<string, ServerRole>;
  
  fetchServers: () => Promise<void>;
  createServer: (name: string, iconUrl?: string | null) => Promise<ServerResponse>;
  deleteServer: (serverId: string) => Promise<void>;
  removeServer: (serverId: string) => void;
  updateServer: (
    serverId: string,
    data: {
      name?: string;
      iconUrl?: string;
      channelCreationPolicy?: ServerResponse['channelCreationPolicy'];
      memberInviteToggle?: boolean;
    },
  ) => Promise<ServerResponse>;
  updateMemberRole: (
    serverId: string,
    userId: string,
    role: 'moderator' | 'member',
  ) => Promise<void>;
  transferOwnership: (serverId: string, toUserId: string) => Promise<void>;
  getInvite: (serverId: string) => Promise<InviteResponse>;
  revokeInvite: (serverId: string) => Promise<void>;
  regenerateInvite: (serverId: string) => Promise<InviteResponse>;
  setCurrentServerId: (id: string | null) => void;
  setMyRole: (serverId: string, role: ServerRole) => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: [],
  currentServerId: null,
  loading: false,
  hasFetched: false,
  error: null,
  myRolesByServer: {},
  
  fetchServers: async () => {
    set({ loading: true, hasFetched: false, error: null });
    try {
      const servers = await apiClient.get<ServerResponse[]>('/servers');
      set({ servers, loading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch servers',
        loading: false,
        hasFetched: true,
      });
    }
  },

  createServer: async (name, iconUrl) => {
    const server = await apiClient.post<ServerResponse>('/servers', { name, iconUrl });
    set((state) => ({ servers: [...state.servers, server], hasFetched: true }));
    return server;
  },

  deleteServer: async (serverId) => {
    await apiClient.delete(`/servers/${serverId}`);
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      currentServerId: state.currentServerId === serverId ? null : state.currentServerId,
    }));
  },

  removeServer: (serverId) =>
    set((state) => {
      const myRolesByServer = { ...state.myRolesByServer };
      delete myRolesByServer[serverId];
      return {
        servers: state.servers.filter((s) => s.id !== serverId),
        currentServerId: state.currentServerId === serverId ? null : state.currentServerId,
        myRolesByServer,
      };
    }),

  updateServer: async (serverId, data) => {
    const server = await apiClient.patch<ServerResponse>(`/servers/${serverId}`, data);
    set((state) => ({
      servers: state.servers.map((s) => (s.id === serverId ? server : s)),
    }));
    return server;
  },

  updateMemberRole: async (serverId, userId, role) => {
    await apiClient.patch(`/servers/${serverId}/members/${userId}/role`, { role });
  },

  transferOwnership: async (serverId, toUserId) => {
    await apiClient.post(`/servers/${serverId}/transfer-ownership`, { toUserId });
  },

  getInvite: async (serverId) => {
    return apiClient.get<InviteResponse>(`/servers/${serverId}/invite`);
  },

  revokeInvite: async (serverId) => {
    await apiClient.delete(`/servers/${serverId}/invite`);
  },

  regenerateInvite: async (serverId) => {
    return apiClient.post<InviteResponse>(`/servers/${serverId}/invite/regenerate`);
  },

  setCurrentServerId: (id) => set({ currentServerId: id }),

  setMyRole: (serverId, role) =>
    set((state) => ({
      myRolesByServer: { ...state.myRolesByServer, [serverId]: role },
    })),
}));
