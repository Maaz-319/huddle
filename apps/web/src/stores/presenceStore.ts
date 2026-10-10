import { create } from 'zustand';

interface PresenceStore {
  onlineUserIds: Set<string>;
  setOnline: (userId: string) => void;
  setOffline: (userId: string) => void;
  setSnapshot: (userIds: string[]) => void;
  isOnline: (userId: string) => boolean;
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  onlineUserIds: new Set(),

  setOnline: (userId) =>
    set((state) => {
      const newSet = new Set(state.onlineUserIds);
      newSet.add(userId);
      return { onlineUserIds: newSet };
    }),

  setOffline: (userId) =>
    set((state) => {
      const newSet = new Set(state.onlineUserIds);
      newSet.delete(userId);
      return { onlineUserIds: newSet };
    }),

  setSnapshot: (userIds) =>
    set({ onlineUserIds: new Set(userIds) }),

  isOnline: (userId) => get().onlineUserIds.has(userId),
}));