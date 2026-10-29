import { create } from 'zustand';
import { authApi } from '@/api/auth';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { ServerMemberResponse } from '@/types/channel';

export type MemberView = ServerMemberResponse & {
  id: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
};

type MembershipEntry = {
  members: MemberView[];
  loading: boolean;
  verified: boolean;
  error: string | null;
};

interface MembershipStore {
  byServer: Record<string, MembershipEntry>;
  userId: string | null;
  refresh: (serverId: string) => Promise<void>;
  invalidate: (serverId: string) => void;
  remove: (serverId: string) => void;
  clear: () => void;
}

const pending = new Map<string, Promise<void>>();
const emptyEntry: MembershipEntry = { members: [], loading: false, verified: false, error: null };
const versions = new Map<string, number>();

export const useMembershipStore = create<MembershipStore>((set, get) => ({
  byServer: {},
  userId: null,
  refresh: (serverId) => {
    const userId = useAuthStore.getState().user?.id ?? null;
    if (userId === null) return Promise.resolve();
    if (get().userId !== userId) {
      for (const currentServerId of Object.keys(get().byServer)) {
        versions.set(currentServerId, (versions.get(currentServerId) ?? 0) + 1);
      }
      pending.clear();
      set({ byServer: {}, userId });
    }
    const existing = pending.get(serverId);
    if (existing) return existing;
    const version = versions.get(serverId) ?? 0;
    const current = get().byServer[serverId] ?? emptyEntry;
    set((state) => ({ byServer: { ...state.byServer, [serverId]: { ...current, loading: true, verified: false, error: null } } }));
    const request = (async () => {
      try {
        const rows = await apiClient.get<ServerMemberResponse[]>(`/servers/${serverId}/members`);
        const users = rows.length ? await authApi.getUsers(rows.map((row) => row.userId)) : [];
        if ((versions.get(serverId) ?? 0) !== version) return;
        const profiles = new Map(users.map((user) => [user.id, user]));
        const members = rows.map((row): MemberView => ({
          ...row,
          id: row.userId,
          username: profiles.get(row.userId)?.username ?? 'Unknown user',
          avatarUrl: profiles.get(row.userId)?.avatarUrl ?? null,
          bio: profiles.get(row.userId)?.bio ?? null,
        }));
        set((state) => ({ byServer: { ...state.byServer, [serverId]: { members, loading: false, verified: true, error: null } } }));
      } catch (error) {
        if ((versions.get(serverId) ?? 0) !== version) return;
        set((state) => ({ byServer: { ...state.byServer, [serverId]: {
          ...(state.byServer[serverId] ?? emptyEntry), loading: false, verified: false,
          error: error instanceof Error ? error.message : 'Failed to load members',
        } } }));
      } finally {
        if ((versions.get(serverId) ?? 0) === version) pending.delete(serverId);
      }
    })();
    pending.set(serverId, request);
    return request;
  },
  invalidate: (serverId) => {
    versions.set(serverId, (versions.get(serverId) ?? 0) + 1);
    pending.delete(serverId);
    set((state) => ({ byServer: { ...state.byServer, [serverId]: { ...(state.byServer[serverId] ?? emptyEntry), verified: false } } }));
    void get().refresh(serverId);
  },
  remove: (serverId) => {
    versions.set(serverId, (versions.get(serverId) ?? 0) + 1);
    pending.delete(serverId);
    set((state) => { const byServer = { ...state.byServer }; delete byServer[serverId]; return { byServer }; });
  },
  clear: () => {
    for (const serverId of Object.keys(get().byServer)) versions.set(serverId, (versions.get(serverId) ?? 0) + 1);
    pending.clear();
    set({ byServer: {}, userId: null });
  },
}));
