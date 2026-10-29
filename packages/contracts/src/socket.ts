import type {
  MessageDeleteResponse,
  MessageResponse,
} from './http.js';

export const SERVER_SOCKET_EVENT = {
  MESSAGE_CREATE: 'message_create',
  MESSAGE_UPDATE: 'message_update',
  MESSAGE_DELETE: 'message_delete',
  TYPING: 'typing',
  PRESENCE_ONLINE: 'presence_online',
  PRESENCE_OFFLINE: 'presence_offline',
  CHANNEL_ADDED: 'channel_added',
  CHANNEL_REMOVED: 'channel_removed',
  MEMBERSHIP_CHANGED: 'membership_changed',
  POLICY_VIOLATION: 'policy_violation',
} as const;

export const CLIENT_SOCKET_EVENT = {
  MESSAGE_SEND: 'message_send',
  MESSAGE_EDIT: 'message_edit',
  MESSAGE_DELETE: 'message_delete',
  TYPING: 'typing',
  CATCH_UP: 'catch_up',
} as const;

export interface TypingBroadcast {
  channelId: string;
  userId: string;
}

export interface PresenceUserPayload {
  userId: string;
}

export type PresenceOnline = PresenceUserPayload;
export type PresenceOffline = PresenceUserPayload;

export interface ChannelIdNotice {
  channelId: string;
}

export type ChannelAdded = ChannelIdNotice;
export type ChannelRemoved = ChannelIdNotice;

export interface MembershipChanged {
  serverId: string;
}

export interface AckError {
  code: string;
  retryable: boolean;
}

export interface AckFailure {
  idempotencyKey?: string;
  error: AckError;
}

export interface SendAckSuccess {
  idempotencyKey: string;
  messageId: string;
  createdAt: string;
}

export interface EditAckSuccess {
  idempotencyKey: string;
  messageId: string;
  editedAt: string | null;
}

export interface DeleteAckSuccess {
  idempotencyKey: string;
  messageId: string;
}

export interface PolicyViolation {
  error: AckError & { code: 'TOO_MANY_VIOLATIONS'; retryable: false };
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

export interface CatchUpSuccess {
  channels: CatchUpChannelResponse[];
}

export type CatchUpAck = CatchUpSuccess | AckFailure;
export type SendAck = SendAckSuccess | AckFailure;
export type EditAck = EditAckSuccess | AckFailure;
export type DeleteAck = DeleteAckSuccess | AckFailure;
export type TypingAck = AckFailure;

export type AckWireResponseMap = {
  [CLIENT_SOCKET_EVENT.MESSAGE_SEND]: SendAck;
  [CLIENT_SOCKET_EVENT.MESSAGE_EDIT]: EditAck;
  [CLIENT_SOCKET_EVENT.MESSAGE_DELETE]: DeleteAck;
  [CLIENT_SOCKET_EVENT.TYPING]: TypingAck;
  [CLIENT_SOCKET_EVENT.CATCH_UP]: CatchUpAck;
};

/** Successful results returned by the web helper after it rejects protocol errors. */
export type AckResponseMap = {
  [CLIENT_SOCKET_EVENT.MESSAGE_SEND]: SendAckSuccess;
  [CLIENT_SOCKET_EVENT.MESSAGE_EDIT]: EditAckSuccess;
  [CLIENT_SOCKET_EVENT.MESSAGE_DELETE]: DeleteAckSuccess;
  [CLIENT_SOCKET_EVENT.TYPING]: Record<never, never>;
  [CLIENT_SOCKET_EVENT.CATCH_UP]: CatchUpSuccess;
};

export type ServerEventMap = {
  [SERVER_SOCKET_EVENT.MESSAGE_CREATE]: MessageResponse;
  [SERVER_SOCKET_EVENT.MESSAGE_UPDATE]: MessageResponse;
  [SERVER_SOCKET_EVENT.MESSAGE_DELETE]: MessageDeleteResponse;
  [SERVER_SOCKET_EVENT.TYPING]: TypingBroadcast;
  [SERVER_SOCKET_EVENT.PRESENCE_ONLINE]: PresenceOnline;
  [SERVER_SOCKET_EVENT.PRESENCE_OFFLINE]: PresenceOffline;
  [SERVER_SOCKET_EVENT.CHANNEL_ADDED]: ChannelAdded;
  [SERVER_SOCKET_EVENT.CHANNEL_REMOVED]: ChannelRemoved;
  [SERVER_SOCKET_EVENT.MEMBERSHIP_CHANGED]: MembershipChanged;
  [SERVER_SOCKET_EVENT.POLICY_VIOLATION]: PolicyViolation;
};

export type ClientEventMap = {
  [CLIENT_SOCKET_EVENT.MESSAGE_SEND]: {
    channelId: string;
    content: string;
    idempotencyKey: string;
  };
  [CLIENT_SOCKET_EVENT.MESSAGE_EDIT]: {
    channelId: string;
    messageId: string;
    content: string;
    idempotencyKey: string;
  };
  [CLIENT_SOCKET_EVENT.MESSAGE_DELETE]: {
    channelId: string;
    messageId: string;
    idempotencyKey: string;
  };
  [CLIENT_SOCKET_EVENT.TYPING]: { channelId: string };
  [CLIENT_SOCKET_EVENT.CATCH_UP]: { channels: CatchUpRequest[] };
};

export type ServerEventType = keyof ServerEventMap;
export type ClientEventType = keyof ClientEventMap;
export type ServerEvent = {
  [K in ServerEventType]: { type: K; payload: ServerEventMap[K] };
}[ServerEventType];
export type ClientEvent = {
  [K in ClientEventType]: { type: K; payload: ClientEventMap[K] };
}[ClientEventType];

export type ConnectErrorCode = 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'REFUSED';
export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
