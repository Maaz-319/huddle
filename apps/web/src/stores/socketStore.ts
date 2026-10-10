import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { SocketStatus, ServerEventMap, ServerEventType } from '@/types/socket';

type TimeoutHandle = ReturnType<typeof setTimeout>;
type EventHandler = (payload: unknown) => void;

interface SocketStore {
  socket: Socket | null;
  status: SocketStatus;
  reconnectAttempt: number;
  maxReconnectDelay: number;
  baseReconnectDelay: number;
  eventHandlers: Map<ServerEventType, Set<EventHandler>>;
  pendingAcks: Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timeout: TimeoutHandle }>;
  
  setSocket: (socket: Socket | null) => void;
  setStatus: (status: SocketStatus) => void;
  incrementReconnectAttempt: () => void;
  resetReconnectAttempt: () => void;
  addEventHandler: <K extends ServerEventType>(event: K, handler: (payload: ServerEventMap[K]) => void) => void;
  removeEventHandler: <K extends ServerEventType>(event: K, handler: (payload: ServerEventMap[K]) => void) => void;
  getEventHandlers: <K extends ServerEventType>(event: K) => Set<EventHandler>;
  addPendingAck: (idempotencyKey: string, promise: { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timeout: TimeoutHandle }) => void;
  resolvePendingAck: (idempotencyKey: string, data: unknown) => void;
  rejectPendingAck: (idempotencyKey: string, error: unknown) => void;
  clearPendingAcks: () => void;
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  status: 'disconnected',
  reconnectAttempt: 0,
  maxReconnectDelay: 30000,
  baseReconnectDelay: 1000,
  eventHandlers: new Map(),
  pendingAcks: new Map(),

  setSocket: (socket) => set({ socket }),
  setStatus: (status) => set({ status }),
  incrementReconnectAttempt: () => set((state) => ({ reconnectAttempt: state.reconnectAttempt + 1 })),
  resetReconnectAttempt: () => set({ reconnectAttempt: 0 }),

  addEventHandler: (event, handler) =>
    set((state) => {
      const newHandlers = new Map(state.eventHandlers);
      const handlers = newHandlers.get(event) ?? new Set();
      handlers.add(handler as EventHandler);
      newHandlers.set(event, handlers);
      return { eventHandlers: newHandlers };
    }),

  removeEventHandler: (event, handler) =>
    set((state) => {
      const newHandlers = new Map(state.eventHandlers);
      const handlers = newHandlers.get(event);
      if (handlers) {
        handlers.delete(handler as EventHandler);
        if (handlers.size === 0) {
          newHandlers.delete(event);
        }
      }
      return { eventHandlers: newHandlers };
    }),

  getEventHandlers: (event) => {
    const handlers = get().eventHandlers.get(event);
    return handlers ?? new Set();
  },

  addPendingAck: (idempotencyKey, promise) =>
    set((state) => {
      const newAcks = new Map(state.pendingAcks);
      newAcks.set(idempotencyKey, promise);
      return { pendingAcks: newAcks };
    }),

  resolvePendingAck: (idempotencyKey, data) =>
    set((state) => {
      const promise = state.pendingAcks.get(idempotencyKey);
      if (promise) {
        clearTimeout(promise.timeout);
        promise.resolve(data);
        const newAcks = new Map(state.pendingAcks);
        newAcks.delete(idempotencyKey);
        return { pendingAcks: newAcks };
      }
      return state;
    }),

  rejectPendingAck: (idempotencyKey, error) =>
    set((state) => {
      const promise = state.pendingAcks.get(idempotencyKey);
      if (promise) {
        clearTimeout(promise.timeout);
        promise.reject(error);
        const newAcks = new Map(state.pendingAcks);
        newAcks.delete(idempotencyKey);
        return { pendingAcks: newAcks };
      }
      return state;
    }),

  clearPendingAcks: () =>
    set((state) => {
      for (const promise of state.pendingAcks.values()) {
        clearTimeout(promise.timeout);
        promise.reject(new Error('Socket disconnected'));
      }
      return { pendingAcks: new Map() };
    }),
}));