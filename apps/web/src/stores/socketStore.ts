import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { SocketStatus } from '@/types/socket';

interface SocketStore {
  socket: Socket | null;
  status: SocketStatus;
  setSocket: (socket: Socket | null) => void;
  setStatus: (status: SocketStatus) => void;
}

export const useSocketStore = create<SocketStore>((set) => ({
  socket: null,
  status: 'disconnected',
  setSocket: (socket) => set({ socket }),
  setStatus: (status) => set({ status }),
}));
