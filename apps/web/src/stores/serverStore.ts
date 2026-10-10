import { create } from 'zustand';
import { apiClient } from '@/api/client';
import type { ServerResponse, InviteResponse } from '@/types/server';

interface ServerStore {
  servers: ServerResponse[];
  currentServerId: string | null;
  loading: boolean;
  error: string | null;
  
  fetchServers: () => Promise<void>;
  createServer: (name: string, iconUrl?: string | null) => Promise<ServerResponse>;
  deleteServer: (serverId: string) => Promise<void>;
  updateServer: (serverId: string, data: { name?: string; iconUrl?: string | null }) => Promise<ServerResponse>;
  getInvite: (serverId: string) => Promise<InviteResponse>;
  revokeInvite: (serverId: string) => Promise<void>;
  regenerateInvite: (serverId: string) => Promise<InviteResponse>;
  setCurrentServerId: (id: string | null) => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: [],
  currentServerId: null,
  loading: false,
  error: null,

  fetchServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await apiClient.get<ServerResponse[]>('/servers');
      set({ servers, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch servers', loading: false });
    }
  },

  createServer: async (name, iconUrl) => {
    const server = await apiClient.post<ServerResponse>('/servers', { name, iconUrl });
    set((state) => ({ servers: [...state.servers, server] }));
    return server;
  },

  deleteServer: async (serverId) => {
    await apiClient.delete(`/servers/${serverId}`);
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      currentServerId: state.currentServerId === serverId ? null : state.currentServerId,
    }));
  },

  updateServer: async (serverId, data) => {
    const server = await apiClient.patch<ServerResponse>(`/servers/${serverId}`, data);
    set((state) => ({
      servers: state.servers.map((s) => (s.id === serverId ? server : s)),
    }));
    return server;
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
}));