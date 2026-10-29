import { useCallback } from 'react';
import { useSocketStore } from '@/stores/socketStore';
import { connectSocket, disconnectSocket, emitWithAck, onServerEvent } from '@/api/socket';
import type { SocketStatus, ClientEventMap, ClientEventType, ServerEventMap, ServerEventType, AckResponseMap } from '@/types/socket';
import { crypto } from '@/utils/crypto';

const IDEMPOTENT_CLIENT_EVENTS: ReadonlySet<string> = new Set([
  'message_send',
  'message_edit',
  'message_delete',
]);

function toWirePayload<K extends ClientEventType>(
  event: K,
  payload: Omit<ClientEventMap[K], 'idempotencyKey'>,
): ClientEventMap[K] {
  return (IDEMPOTENT_CLIENT_EVENTS.has(event)
    ? { ...payload, idempotencyKey: crypto.randomUUID() }
    : payload) as ClientEventMap[K];
}

export function useSocket() {
  const { socket, status } = useSocketStore();

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
      return emitWithAck(event, toWirePayload(event, payload), timeoutMs);
    },
    []
  );

  const emitNoAck = useCallback(
    <K extends ClientEventType>(
      event: K,
      payload: Omit<ClientEventMap[K], 'idempotencyKey'>,
    ): void => {
      socket?.emit(event, toWirePayload(event, payload));
    },
    [socket],
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
    emitNoAck,
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
