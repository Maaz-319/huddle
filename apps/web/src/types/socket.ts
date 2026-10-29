import type {
  ClientEventMap,
  ClientEventType,
  AckResponseMap,
  ServerEventMap,
  ServerEventType,
  MessageResponse as WireMessageResponse,
  SocketStatus,
} from '@huddle/contracts';

export * from '@huddle/contracts';

/** The transcript's local view adds optimistic-delivery state to the wire message. */
export interface MessageResponse extends WireMessageResponse {
  pending?: boolean;
  failed?: boolean;
  uncertain?: boolean;
  retryExpiresAt?: number;
  idempotencyKey?: string;
}

/** Client-owned socket state; event contracts themselves live in @huddle/contracts. */
export interface SocketState {
  socket: import('socket.io-client').Socket | null;
  status: SocketStatus;
  connect: () => void;
  disconnect: () => void;
  emitWithAck: <K extends ClientEventType>(
    event: K,
    payload: ClientEventMap[K],
    timeoutMs?: number,
  ) => Promise<AckResponseMap[K]>;
  on: <K extends ServerEventType>(
    event: K,
    handler: (payload: ServerEventMap[K]) => void,
  ) => () => void;
  off: <K extends ServerEventType>(
    event: K,
    handler: (payload: ServerEventMap[K]) => void,
  ) => void;
}
