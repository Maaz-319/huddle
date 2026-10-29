/**
 * Type-safe WebSocket event map matching backend ChatGateway events.
 * All payloads use string IDs (JSON serialization of bigint Snowflakes).
 */

export interface MessageResponse {
  id: string;
  channelId: string;
  authorId: string;
  author: {
    id: string;
    username: string;
    avatarUrl: string;
  };
  // Nullable on the wire: a soft-deleted message still arrives (history
  // renders a "message deleted" placeholder), but its text never does.
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  isDeleted: boolean;
  // Client-side only fields for optimistic updates
  pending?: boolean;
  failed?: boolean;
}

export interface MessageDeleteResponse {
  id: string;
  channelId: string;
}

export interface TypingBroadcast {
  channelId: string;
  userId: string;
}

export interface PresenceOnline {
  userId: string;
}

export interface PresenceOffline {
  userId: string;
}

export interface ChannelAdded {
  channelId: string;
}

export interface ChannelRemoved {
  channelId: string;
}

export interface PolicyViolation {
  error: {
    code: 'TOO_MANY_VIOLATIONS';
    retryable: false;
  };
}

export interface CatchUpRequest {
  channelId: string;
  afterMessageId: string | null;
}

export interface CatchUpChannelResponse {
  channelId: string;
  messages: MessageResponse[];
  truncated: boolean;
}

export interface CatchUpAck {
  channels: CatchUpChannelResponse[];
  error?: AckError;
}

export interface SendAck {
  idempotencyKey: string;
  messageId: string;
  createdAt: string;
  error?: AckError;
}

export interface EditAck {
  idempotencyKey: string;
  messageId: string;
  editedAt: string;
  error?: AckError;
}

export interface DeleteAck {
  idempotencyKey: string;
  messageId: string;
  error?: AckError;
}

export interface TypingAck {
  error?: AckError;
}

export interface AckError {
  code: string;
  retryable: boolean;
}

export type ServerEvent =
  | { type: 'message_create'; payload: MessageResponse }
  | { type: 'message_update'; payload: MessageResponse }
  | { type: 'message_delete'; payload: MessageDeleteResponse }
  | { type: 'typing'; payload: TypingBroadcast }
  | { type: 'presence_online'; payload: PresenceOnline }
  | { type: 'presence_offline'; payload: PresenceOffline }
  | { type: 'channel_added'; payload: ChannelAdded }
  | { type: 'channel_removed'; payload: ChannelRemoved }
  | { type: 'policy_violation'; payload: PolicyViolation };

export type ClientEvent =
  | { type: 'message_send'; payload: { channelId: string; content: string; idempotencyKey: string } }
  | { type: 'message_edit'; payload: { channelId: string; messageId: string; content: string; idempotencyKey: string } }
  | { type: 'message_delete'; payload: { channelId: string; messageId: string; idempotencyKey: string } }
  | { type: 'typing'; payload: { channelId: string } }
  | { type: 'catch_up'; payload: { channels: CatchUpRequest[] } };

export type ServerEventType = ServerEvent['type'];
export type ClientEventType = ClientEvent['type'];

export type ServerEventMap = {
  message_create: MessageResponse;
  message_update: MessageResponse;
  message_delete: MessageDeleteResponse;
  typing: TypingBroadcast;
  presence_online: PresenceOnline;
  presence_offline: PresenceOffline;
  channel_added: ChannelAdded;
  channel_removed: ChannelRemoved;
  policy_violation: PolicyViolation;
};

export type ClientEventMap = {
  message_send: { channelId: string; content: string; idempotencyKey: string };
  message_edit: { channelId: string; messageId: string; content: string; idempotencyKey: string };
  message_delete: { channelId: string; messageId: string; idempotencyKey: string };
  typing: { channelId: string };
  catch_up: { channels: CatchUpRequest[] };
};

export type AckResponseMap = {
  message_send: SendAck;
  message_edit: EditAck;
  message_delete: DeleteAck;
  typing: TypingAck;
  catch_up: CatchUpAck;
};

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SocketState {
  socket: import('socket.io-client').Socket | null;
  status: SocketStatus;
  connect: () => void;
  disconnect: () => void;
  emitWithAck: <K extends ClientEventType>(
    event: K,
    payload: ClientEventMap[K],
    timeoutMs?: number
  ) => Promise<AckResponseMap[K]>;
  on: <K extends ServerEventType>(
    event: K,
    handler: (payload: ServerEventMap[K]) => void
  ) => () => void;
  off: <K extends ServerEventType>(event: K, handler: (payload: ServerEventMap[K]) => void) => void;
}