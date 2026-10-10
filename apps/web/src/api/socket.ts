import { io, Socket } from 'socket.io-client';
import { useSocketStore } from '@/stores/socketStore';
import { usePresenceStore } from '@/stores/presenceStore';
import type { SocketStatus, ServerEventMap, ServerEventType, ClientEventType, ClientEventMap, AckResponseMap } from '@/types/socket';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

let socketInstance: Socket | null = null;

function createSocket(): Socket {
  const socket = io(API_URL, {
    auth: {},
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnection: false,
  });

  socketInstance = socket;
  return socket;
}

function destroySocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function calculateReconnectDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = delay * 0.1 * Math.random();
  return Math.floor(delay + jitter);
}

function setupSocketListeners(socket: Socket): void {
  const { setStatus, incrementReconnectAttempt, resetReconnectAttempt, getEventHandlers, clearPendingAcks } = useSocketStore.getState();

  socket.on('connect', () => {
    if (import.meta.env.DEV) {
      console.log('[Socket] Connected:', socket.id);
    }
    setStatus('connected');
    resetReconnectAttempt();
  });

  socket.on('disconnect', (reason) => {
    if (import.meta.env.DEV) {
      console.log('[Socket] Disconnected:', reason);
    }
    setStatus('disconnected');
    clearPendingAcks();
  });

  socket.on('connect_error', (error) => {
    if (import.meta.env.DEV) {
      console.error('[Socket] Connection error:', error.message);
    }
    setStatus('error');
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    if (import.meta.env.DEV) {
      console.log('[Socket] Reconnection attempt:', attemptNumber);
    }
    setStatus('connecting');
    incrementReconnectAttempt();
  });

  socket.on('reconnect', (attemptNumber) => {
    if (import.meta.env.DEV) {
      console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
    }
    setStatus('connected');
    resetReconnectAttempt();
  });

  socket.on('reconnect_failed', () => {
    if (import.meta.env.DEV) {
      console.error('[Socket] Reconnection failed');
    }
    setStatus('error');
  });

  // Handle server events
  const serverEvents: ServerEventType[] = [
    'message_create', 'message_update', 'message_delete',
    'typing', 'presence_online', 'presence_offline',
    'channel_added', 'channel_removed', 'policy_violation'
  ];

  for (const event of serverEvents) {
    socket.on(event, (payload: unknown) => {
      if (import.meta.env.DEV) {
        console.log('[Socket] Event received:', event, payload);
      }
      const handlers = getEventHandlers(event);
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[Socket] Handler error for ${event}:`, error);
        }
      }
    });
  }

  // Register presence handlers to update presence store
  socket.on('presence_online', (payload: { userId: string }) => {
    usePresenceStore.getState().setOnline(payload.userId);
  });

  socket.on('presence_offline', (payload: { userId: string }) => {
    usePresenceStore.getState().setOffline(payload.userId);
  });
}

export function connectSocket(): Socket {
  const { socket, status, setSocket, setStatus, baseReconnectDelay, maxReconnectDelay } = useSocketStore.getState();
  
  if (socket && (status === 'connected' || status === 'connecting')) {
    return socket;
  }

  let socketToUse = socket;
  if (!socketToUse) {
    socketToUse = createSocket();
    setupSocketListeners(socketToUse);
    setSocket(socketToUse);
  }

  setStatus('connecting');
  
  // Implement custom reconnection with exponential backoff
  socketToUse.io.reconnection(false);
  socketToUse.connect();

  // Set up reconnection logic
  const attemptReconnect = () => {
    const { status: currentStatus, reconnectAttempt: currentAttempt } = useSocketStore.getState();
    if (currentStatus === 'connected') return;
    
    const delay = calculateReconnectDelay(currentAttempt, baseReconnectDelay, maxReconnectDelay);
    if (import.meta.env.DEV) {
      console.log(`[Socket] Reconnecting in ${delay}ms (attempt ${currentAttempt + 1})`);
    }
    
    setTimeout(() => {
      const { status: latestStatus } = useSocketStore.getState();
      if (latestStatus !== 'connected') {
        socketToUse?.connect();
      }
    }, delay);
  };

  socketToUse.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      // Server initiated disconnect, don't reconnect
      return;
    }
    // Client-side disconnect, attempt reconnect
    attemptReconnect();
  });

  return socketToUse;
}

export function disconnectSocket(): void {
  const { socket, clearPendingAcks, setSocket, setStatus } = useSocketStore.getState();
  
  if (socket) {
    socket.disconnect();
    clearPendingAcks();
    setSocket(null);
    setStatus('disconnected');
  }
  destroySocket();
}

export function emitWithAck<K extends ClientEventType>(
  event: K,
  payload: ClientEventMap[K],
  timeoutMs = 10000
): Promise<AckResponseMap[K]> {
  const { socket } = useSocketStore.getState();
  
  if (!socket || !socket.connected) {
    return Promise.reject(new Error('Socket not connected'));
  }

  return new Promise<AckResponseMap[K]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Ack timeout for ${event}`));
    }, timeoutMs);

    // Store the promise resolvers
    const { addPendingAck, resolvePendingAck, rejectPendingAck } = useSocketStore.getState();
    addPendingAck(payload.idempotencyKey, { 
      resolve: resolve as (value: unknown) => void, 
      reject, 
      timeout 
    });

    // Emit with ack callback
    socket.emit(event, payload, (response: AckResponseMap[K]) => {
      if ('error' in response && response.error) {
        rejectPendingAck(payload.idempotencyKey, new Error(response.error.code));
      } else {
        resolvePendingAck(payload.idempotencyKey, response);
      }
    });
  });
}

export function onServerEvent<K extends ServerEventType>(
  event: K,
  handler: (payload: ServerEventMap[K]) => void
): () => void {
  const { addEventHandler, removeEventHandler } = useSocketStore.getState();
  addEventHandler(event, handler);
  return () => removeEventHandler(event, handler);
}

export function getSocketStatus(): SocketStatus {
  return useSocketStore.getState().status;
}

export function getSocketInstance(): Socket | null {
  return useSocketStore.getState().socket;
}