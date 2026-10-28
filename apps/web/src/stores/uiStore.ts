import { create } from 'zustand';

interface UIState {
  // Sidebar / drawer states — session-only on purpose: what fits one
  // breakpoint (phone drawers) is wrong for another (desktop columns), so
  // these are reseeded on every load rather than persisted.
  isChannelListOpen: boolean;
  isMemberSidebarOpen: boolean;
  isServerListOpen: boolean;
  isCreateServerDialogOpen: boolean;

  // Mobile navigation
  activeMobileTab: 'servers' | 'channels' | 'messages' | 'members';

  // Actions
  toggleChannelList: () => void;
  toggleMemberSidebar: () => void;
  toggleServerList: () => void;
  setChannelListOpen: (open: boolean) => void;
  setMemberSidebarOpen: (open: boolean) => void;
  setServerListOpen: (open: boolean) => void;
  setCreateServerDialogOpen: (open: boolean) => void;
  setActiveMobileTab: (tab: 'servers' | 'channels' | 'messages' | 'members') => void;
  closeAllDrawers: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isChannelListOpen: true,
  isMemberSidebarOpen: false,
  isServerListOpen: false,
  isCreateServerDialogOpen: false,
  activeMobileTab: 'messages',

  toggleChannelList: () => set((state) => ({ isChannelListOpen: !state.isChannelListOpen })),
  toggleMemberSidebar: () => set((state) => ({ isMemberSidebarOpen: !state.isMemberSidebarOpen })),
  toggleServerList: () => set((state) => ({ isServerListOpen: !state.isServerListOpen })),
  setChannelListOpen: (open) => set({ isChannelListOpen: open }),
  setMemberSidebarOpen: (open) => set({ isMemberSidebarOpen: open }),
  setServerListOpen: (open) => set({ isServerListOpen: open }),
  setCreateServerDialogOpen: (open) => set({ isCreateServerDialogOpen: open }),
  setActiveMobileTab: (tab) => set({ activeMobileTab: tab }),
  closeAllDrawers: () =>
    set({
      isChannelListOpen: false,
      isMemberSidebarOpen: false,
      isServerListOpen: false,
    }),
}));
