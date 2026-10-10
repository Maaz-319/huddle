import { useEffect, useCallback, useRef } from 'react';
import { useSocketStore } from '@/stores/socketStore';
import { connectSocket, disconnectSocket, emitWithAck, onServerEvent } from '@/api/socket';
import type { SocketStatus, ClientEventMap, ClientEventType, ServerEventMap, ServerEventType, AckResponseMap } from '@/types/socket';
import { crypto } from '@/utils/crypto';

export function useSocket() {
  const { socket, status } = useSocketStore();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      connectSocket();
    }
  }, []);

  const connect = useCallback(() => {
    connectSocket();
  }, []);

  const disconnect = useCallback(() => {
    disconnectSocket();
  }, []);

  const emit = useCallback(
    async <K extends ClientEventType>(
      event: K,
      payload: Omit<ClientEventMap[K], 'idempotencyKey'>,
      timeoutMs?: number
    ): Promise<AckResponseMap[K]> => {
      const idempotencyKey = crypto.randomUUID();
      const payloadWithKey = { ...payload, idempotencyKey } as ClientEventMap[K];
      return emitWithAck(event, payloadWithKey, timeoutMs);
    },
    []
  );

  const on = useCallback(
    <K extends ServerEventType>(
      event: K,
      handler: (payload: ServerEventMap[K]) => void
    ): (() => void) => {
      return onServerEvent(event, handler);
    },
    []
  );

  const off = useCallback(() => {
    // The cleanup function from on() handles this
  }, []);

  return {
    socket,
    status,
    connect,
    disconnect,
    emit,
    on,
    off,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',
    isDisconnected: status === 'disconnected',
    hasError: status === 'error',
  };
}

export function useSocketStatus(): SocketStatus {
  return useSocketStore((state) => state.status);
}

export function useSocketInstance() {
  return useSocketStore((state) => state.socket);
}