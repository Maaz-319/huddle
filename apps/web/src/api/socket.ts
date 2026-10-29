import { API_BASE } from './apiBase';
import {
  SERVER_SOCKET_EVENT,
  type PresenceOffline,
  type PresenceOnline,
} from '@huddle/contracts';
import { io, Socket } from 'socket.io-client';
import { useSocketStore } from '@/stores/socketStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { crypto } from '@/utils/crypto';
import type {
  AckResponseMap,
  AckWireResponseMap,
  ClientEventMap,
  ClientEventType,
  ConnectErrorCode,
  ServerEventMap,
  ServerEventType,
  SocketStatus,
} from '@/types/socket';

const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

type TimeoutHandle = ReturnType<typeof setTimeout>;
type EventHandler = (payload: unknown) => void;
type PendingAck = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timeout: TimeoutHandle };
type ConnectError = Error & { data?: { code?: ConnectErrorCode; retryAfter?: number } };

let socketInstance: Socket | null = null;
let reconnectTimer: TimeoutHandle | null = null;
let reconnectAttempt = 0;
let intentionalDisconnect = false;
let authRefreshAttempted = false;
let eventHandlers = new Map<ServerEventType, Set<EventHandler>>();
const pendingAcks = new Map<string, PendingAck>();

export class SocketAckError extends Error {
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = 'SocketAckError';
    this.retryable = retryable;
  }
}

function setStatus(status: SocketStatus): void {
  useSocketStore.getState().setStatus(status);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function settlePendingAcks(error: Error): void {
  for (const [key, pending] of pendingAcks) {
    clearTimeout(pending.timeout);
    pending.reject(error);
    pendingAcks.delete(key);
  }
}

function createSocket(): Socket {
  const socket = io(API_BASE, {
    auth: {},
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnection: false,
  });

  socketInstance = socket;
  useSocketStore.getState().setSocket(socket);
  setupSocketListeners(socket);
  return socket;
}

function calculateReconnectDelay(attempt: number): number {
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
  return Math.floor(delay + delay * 0.1 * Math.random());
}

function scheduleReconnect(delay: number): void {
  clearReconnectTimer();
  if (intentionalDisconnect) return;
  setStatus('connecting');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!intentionalDisconnect && socketInstance && !socketInstance.connected) {
      socketInstance.connect();
    }
  }, delay);
}

function stopForRefusal(): void {
  clearReconnectTimer();
  setStatus('error');
}

function handleConnectError(rawError: Error): void {
  const error = rawError as ConnectError;
  const code = error.data?.code;
  if (import.meta.env.DEV) console.error('[Socket] Connection error:', error.message, code);

  if (code === 'RATE_LIMITED') {
    reconnectAttempt = 0;
    scheduleReconnect(Math.max(0, error.data?.retryAfter ?? 1000));
    return;
  }

  if (code === 'AUTH_REQUIRED') {
    stopForRefusal();
    if (authRefreshAttempted) return;
    authRefreshAttempted = true;
    void authApi.getMe().then((user) => {
      useAuthStore.getState().setUser(user);
      intentionalDisconnect = false;
      setStatus('connecting');
      socketInstance?.connect();
    }).catch((authError: unknown) => {
      if (authError instanceof Error && authError.message === 'UNAUTHORIZED') {
        useAuthStore.getState().setUser(null);
      }
    });
    return;
  }

  if (code === 'REFUSED') {
    stopForRefusal();
    return;
  }

  // Socket.IO emits a data-less connect_error for transport failures. These
  // remain transient; the backend uses the stable codes above for refusals.
  const delay = calculateReconnectDelay(reconnectAttempt);
  reconnectAttempt += 1;
  scheduleReconnect(delay);
}

function dispatchServerEvent<K extends ServerEventType>(event: K, payload: ServerEventMap[K]): void {
  const handlers = eventHandlers.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`[Socket] Handler error for ${event}:`, error);
    }
  }
}

function setupSocketListeners(socket: Socket): void {
  socket.on('connect', () => {
    if (import.meta.env.DEV) console.log('[Socket] Connected:', socket.id);
    intentionalDisconnect = false;
    authRefreshAttempted = false;
    reconnectAttempt = 0;
    clearReconnectTimer();
    setStatus('connected');
  });

  socket.on('disconnect', (reason) => {
    if (import.meta.env.DEV) console.log('[Socket] Disconnected:', reason);
    settlePendingAcks(new Error('Socket disconnected'));
    if (intentionalDisconnect) {
      setStatus('disconnected');
      return;
    }
    if (reason === 'io server disconnect') {
      stopForRefusal();
      return;
    }
    const delay = calculateReconnectDelay(reconnectAttempt);
    reconnectAttempt += 1;
    scheduleReconnect(delay);
  });

  socket.on('connect_error', handleConnectError);

  const serverEvents: ServerEventType[] = Object.values(SERVER_SOCKET_EVENT);

  for (const event of serverEvents) {
    socket.on(event, (payload: unknown) => {
      if (import.meta.env.DEV) console.log('[Socket] Event received:', event, payload);
      // The event name selects its payload type; the registered listener is
      // the typed dispatch seam for Socket.IO's untyped event overload.
      dispatchServerEvent(event, payload as ServerEventMap[typeof event]);
    });
  }

  socket.on(SERVER_SOCKET_EVENT.PRESENCE_ONLINE, (payload: PresenceOnline) => {
    usePresenceStore.getState().setOnline(payload.userId);
  });
  socket.on(SERVER_SOCKET_EVENT.PRESENCE_OFFLINE, (payload: PresenceOffline) => {
    usePresenceStore.getState().setOffline(payload.userId);
  });
}

/** Connect once; all transport, retry, event, and acknowledgement lifecycle stays here. */
export function connectSocket(): Socket {
  intentionalDisconnect = false;
  clearReconnectTimer();
  const socket = socketInstance ?? createSocket();
  if (socket.connected || useSocketStore.getState().status === 'connecting') return socket;
  authRefreshAttempted = false;
  setStatus('connecting');
  socket.connect();
  return socket;
}

export function disconnectSocket(): void {
  intentionalDisconnect = true;
  clearReconnectTimer();
  settlePendingAcks(new Error('Socket disconnected'));
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
  eventHandlers = new Map();
  useSocketStore.getState().setSocket(null);
  setStatus('disconnected');
  reconnectAttempt = 0;
  authRefreshAttempted = false;
}

export function emitWithAck<K extends ClientEventType>(
  event: K,
  payload: ClientEventMap[K],
  timeoutMs = 10000,
): Promise<AckResponseMap[K]> {
  const socket = socketInstance;
  if (!socket?.connected) return Promise.reject(new Error('Socket not connected'));

  return new Promise<AckResponseMap[K]>((resolve, reject) => {
    const ackKey = crypto.randomUUID();
    const timeout = setTimeout(() => {
      const pending = pendingAcks.get(ackKey);
      if (!pending) return;
      pendingAcks.delete(ackKey);
      pending.reject(new Error(`Ack timeout for ${event}`));
    }, timeoutMs);
    pendingAcks.set(ackKey, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    socket.emit(event, payload, (response: AckWireResponseMap[K]) => {
      const pending = pendingAcks.get(ackKey);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingAcks.delete(ackKey);
      if ('error' in response && response.error) {
        pending.reject(new SocketAckError(response.error.code, response.error.retryable));
      } else {
        pending.resolve(response);
      }
    });
  });
}

export function onServerEvent<K extends ServerEventType>(
  event: K,
  handler: (payload: ServerEventMap[K]) => void,
): () => void {
  const handlers = eventHandlers.get(event) ?? new Set<EventHandler>();
  handlers.add(handler as EventHandler);
  eventHandlers.set(event, handlers);
  return () => {
    handlers.delete(handler as EventHandler);
    if (handlers.size === 0) eventHandlers.delete(event);
  };
}

export function getSocketStatus(): SocketStatus {
  return useSocketStore.getState().status;
}

export function getSocketInstance(): Socket | null {
  return socketInstance;
}
