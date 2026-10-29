import { create } from 'zustand';
import type { MessageResponse } from '@/types/socket';

export interface PendingMessage {
  idempotencyKey: string;
  message: MessageResponse;
  attemptedAt: number;
  autoRetried: boolean;
  transport: 'socket' | 'rest';
}

interface MessageStore {
  lastMessageIds: Map<string, string>;
  messagesByChannel: Map<string, MessageResponse[]>;
  pendingMessages: Map<string, PendingMessage>;
  hasMoreByChannel: Map<string, boolean>;
  loadingByChannel: Map<string, boolean>;
  errorByChannel: Map<string, string>;
  gapByChannel: Map<string, boolean>;
  currentChannelId: string | null;

  setCurrentChannelId: (channelId: string | null) => void;
  setLastMessageId: (channelId: string, messageId: string) => void;
  getLastMessageId: (channelId: string) => string | null;
  addMessages: (channelId: string, messages: MessageResponse[]) => void;
  prependMessages: (channelId: string, messages: MessageResponse[]) => void;
  updateMessage: (channelId: string, message: MessageResponse) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  clearChannel: (channelId: string) => void;
  replaceRecent: (channelId: string, messages: MessageResponse[], hasMore: boolean, retainedAfter: string | null) => void;
  getMessages: (channelId: string) => MessageResponse[];
  setHasMore: (channelId: string, hasMore: boolean) => void;
  getHasMore: (channelId: string) => boolean;
  setLoading: (channelId: string, loading: boolean) => void;
  getLoading: (channelId: string) => boolean;
  setError: (channelId: string, error: string | null) => void;
  getError: (channelId: string) => string | null;
  setGap: (channelId: string, gap: boolean) => void;
  getGap: (channelId: string) => boolean;

  // Optimistic updates
  addPendingMessage: (idempotencyKey: string, message: MessageResponse, transport: 'socket' | 'rest') => void;
  resolvePendingMessage: (idempotencyKey: string, message: MessageResponse) => void;
  rejectPendingMessage: (idempotencyKey: string) => void;
  markUncertain: (idempotencyKey: string) => void;
  markRetrying: (idempotencyKey: string, automatic: boolean) => void;
  removePendingMessage: (idempotencyKey: string) => void;
  getPendingMessage: (idempotencyKey: string) => PendingMessage | undefined;

  // Event handlers for real-time updates
  onMessageCreate: (message: MessageResponse) => void;
  onMessageUpdate: (message: MessageResponse) => void;
  onMessageDelete: (payload: { id: string; channelId: string }) => void;
}

/**
 * Transcript order is **ascending — oldest → newest**: the API's contract
 * (ChatService.getHistory / message.controller.ts) and what MessageList
 * renders (index 0 at the top, the last row at the bottom, `before=`
 * cursor taken from `messages[0]`). Every insert below obeys it.
 */

const TRANSCRIPT_LIMIT = 500;

/**
 * Applied only to live-growth paths. History loads and pagination never
 * trim — `load older` must not delete the rows it just fetched.
 */
function trimLive(messages: MessageResponse[]): MessageResponse[] {
  return messages.length > TRANSCRIPT_LIMIT
    ? messages.slice(-TRANSCRIPT_LIMIT)
    : messages;
}

/** Optimistic rows (`pending-…` ids) are not Snowflakes; they sort last. */
function isSnowflakeId(id: string): boolean {
  return /^\d+$/.test(id);
}

function sortAscending(messages: MessageResponse[]): MessageResponse[] {
  return [...messages].sort((a, b) => {
    const aPending = !isSnowflakeId(a.id);
    const bPending = !isSnowflakeId(b.id);
    if (aPending !== bPending) return aPending ? 1 : -1;
    if (aPending) return 0; // stable: optimistic rows keep arrival order
    const left = BigInt(a.id);
    const right = BigInt(b.id);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Dedupe by id, then order ascending. The incoming copy wins — it came from
 * the server — except while a local edit/delete for that id is in flight,
 * when the optimistic copy stays until its ack lands.
 */
function mergeBatch(
  existing: MessageResponse[],
  incoming: MessageResponse[],
): MessageResponse[] {
  const byId = new Map<string, MessageResponse>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) {
    const held = byId.get(message.id);
    if (held?.pending === true) continue;
    byId.set(message.id, message);
  }
  return sortAscending(Array.from(byId.values()));
}

/**
 * `lastMessageIds` is the newest message the client actually **holds** per
 * channel — the cursor catch-up asks the server to reply after (and the
 * backend names "the last id it holds"). It advances, never regresses, and
 * never records an optimistic id.
 */
function advanceLastMessageId(
  lastIds: Map<string, string>,
  channelId: string,
  messageId: string,
): Map<string, string> {
  if (!isSnowflakeId(messageId)) return lastIds;
  const current = lastIds.get(channelId);
  if (
    current !== undefined &&
    isSnowflakeId(current) &&
    BigInt(current) >= BigInt(messageId)
  ) {
    return lastIds;
  }
  const next = new Map(lastIds);
  next.set(channelId, messageId);
  return next;
}

function newestSnowflakeIn(messages: MessageResponse[]): string | null {
  let newest: string | null = null;
  for (const message of messages) {
    if (!isSnowflakeId(message.id)) continue;
    if (newest === null || BigInt(message.id) > BigInt(newest)) {
      newest = message.id;
    }
  }
  return newest;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  lastMessageIds: new Map(),
  messagesByChannel: new Map(),
  pendingMessages: new Map(),
  hasMoreByChannel: new Map(),
  loadingByChannel: new Map(),
  errorByChannel: new Map(),
  gapByChannel: new Map(),
  currentChannelId: null,

  setCurrentChannelId: (channelId) => set({ currentChannelId: channelId }),

  setLastMessageId: (channelId, messageId) =>
    set((state) => ({
      lastMessageIds: advanceLastMessageId(
        state.lastMessageIds,
        channelId,
        messageId,
      ),
    })),

  getLastMessageId: (channelId) => {
    return get().lastMessageIds.get(channelId) ?? null;
  },

  addMessages: (channelId, messages) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, mergeBatch(existing, messages));

      const newest = newestSnowflakeIn(messages);
      return {
        messagesByChannel: newMap,
        lastMessageIds:
          newest !== null
            ? advanceLastMessageId(state.lastMessageIds, channelId, newest)
            : state.lastMessageIds,
      };
    }),

  prependMessages: (channelId, messages) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Older page (`?before=`): it sits ABOVE what we hold. No trim —
      // pagination must keep the rows it just fetched — and no last-id
      // advance: an older page can never hold the channel's newest message.
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, mergeBatch(existing, messages));
      return { messagesByChannel: newMap };
    }),

  updateMessage: (channelId, message) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const index = existing.findIndex((m) => m.id === message.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = message;
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, updated);
      return { messagesByChannel: newMap };
    }),

  removeMessage: (channelId, messageId) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      const filtered = existing.filter((m) => m.id !== messageId);
      const newMap = new Map(state.messagesByChannel);
      newMap.set(channelId, filtered);
      return { messagesByChannel: newMap };
    }),

  clearChannel: (channelId) =>
    set((state) => {
      const newMessages = new Map(state.messagesByChannel);
      newMessages.delete(channelId);
      const newLastIds = new Map(state.lastMessageIds);
      newLastIds.delete(channelId);
      const newHasMore = new Map(state.hasMoreByChannel);
      newHasMore.delete(channelId);
      const newLoading = new Map(state.loadingByChannel);
      newLoading.delete(channelId);
      const newErrors = new Map(state.errorByChannel);
      newErrors.delete(channelId);
      const newGaps = new Map(state.gapByChannel);
      newGaps.delete(channelId);
      const newPending = new Map(state.pendingMessages);
      for (const [key, pending] of newPending) {
        if (pending.message.channelId === channelId) newPending.delete(key);
      }
      return { messagesByChannel: newMessages, lastMessageIds: newLastIds, hasMoreByChannel: newHasMore, loadingByChannel: newLoading, errorByChannel: newErrors, gapByChannel: newGaps, pendingMessages: newPending };
    }),

  replaceRecent: (channelId, messages, hasMore, retainedAfter) =>
    set((state) => {
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Preserve events that arrived while the HTTP request was in flight.
      // On an initial load there was no cursor, so every existing row is new.
      const retained = existing.filter((message) =>
        !isSnowflakeId(message.id) ||
        retainedAfter === null || BigInt(message.id) > BigInt(retainedAfter)
      );
      const rows = mergeBatch(retained, messages);
      const nextMessages = new Map(state.messagesByChannel);
      nextMessages.set(channelId, rows);
      const nextLast = new Map(state.lastMessageIds);
      const latest = newestSnowflakeIn(rows);
      if (latest === null) nextLast.delete(channelId);
      else nextLast.set(channelId, latest);
      const nextHasMore = new Map(state.hasMoreByChannel);
      nextHasMore.set(channelId, hasMore);
      return { messagesByChannel: nextMessages, lastMessageIds: nextLast, hasMoreByChannel: nextHasMore };
    }),

  getMessages: (channelId) => {
    return get().messagesByChannel.get(channelId) ?? [];
  },

  setHasMore: (channelId, hasMore) =>
    set((state) => {
      const newMap = new Map(state.hasMoreByChannel);
      newMap.set(channelId, hasMore);
      return { hasMoreByChannel: newMap };
    }),

  getHasMore: (channelId) => {
    return get().hasMoreByChannel.get(channelId) ?? true;
  },

  setLoading: (channelId, loading) =>
    set((state) => {
      const newMap = new Map(state.loadingByChannel);
      newMap.set(channelId, loading);
      return { loadingByChannel: newMap };
    }),

  getLoading: (channelId) => {
    return get().loadingByChannel.get(channelId) ?? false;
  },

  setError: (channelId, error) => set((state) => {
    const next = new Map(state.errorByChannel);
    if (error === null) next.delete(channelId);
    else next.set(channelId, error);
    return { errorByChannel: next };
  }),
  getError: (channelId) => get().errorByChannel.get(channelId) ?? null,
  setGap: (channelId, gap) => set((state) => {
    const next = new Map(state.gapByChannel);
    next.set(channelId, gap);
    return { gapByChannel: next };
  }),
  getGap: (channelId) => get().gapByChannel.get(channelId) ?? false,

  addPendingMessage: (idempotencyKey, message, transport) =>
    set((state) => {
      const newPendingMap = new Map(state.pendingMessages);
      newPendingMap.set(idempotencyKey, { idempotencyKey, message, attemptedAt: Date.now(), autoRetried: false, transport });

      // Optimistic rows live in the visible transcript, not a side channel —
      // otherwise nothing appears until the ack lands. The newest row
      // belongs at the END of the ascending transcript.
      const existing = state.messagesByChannel.get(message.channelId) ?? [];
      const newMessages = new Map(state.messagesByChannel);
      newMessages.set(
        message.channelId,
        trimLive(sortAscending([...existing, message])),
      );

      return { pendingMessages: newPendingMap, messagesByChannel: newMessages };
    }),

  resolvePendingMessage: (idempotencyKey, message) =>
    set((state) => {
      const pending = state.pendingMessages.get(idempotencyKey);
      if (!pending) return state;

      const channelId = pending.message.channelId;
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Replace the optimistic row where it sits; drop any broadcast copy
      // that already arrived under the real id; the confirmed message
      // appears exactly once, at its id's place in the ascending order.
      const replaced = existing
        .filter((m) => m.id !== message.id)
        .map((m) => (m.id === pending.message.id ? message : m));
      const rows = replaced.some((m) => m.id === message.id)
        ? replaced
        : [...replaced, message];

      const newMessagesMap = new Map(state.messagesByChannel);
      newMessagesMap.set(channelId, trimLive(sortAscending(rows)));

      const newPendingMap = new Map(state.pendingMessages);
      newPendingMap.delete(idempotencyKey);

      return {
        messagesByChannel: newMessagesMap,
        pendingMessages: newPendingMap,
        lastMessageIds: advanceLastMessageId(
          state.lastMessageIds,
          channelId,
          message.id,
        ),
      };
    }),

  rejectPendingMessage: (idempotencyKey) =>
    set((state) => {
      const pending = state.pendingMessages.get(idempotencyKey);
      if (!pending) return state;

      const channelId = pending.message.channelId;
      const existing = state.messagesByChannel.get(channelId) ?? [];
      // Keep the row, flagged failed, so the user can retry or discard —
      // silently dropping a typed message is worse than any error chrome.
      const updated = existing.map((m) =>
        m.id === pending.message.id ? { ...m, pending: false, failed: true } : m
      );

      const newMessagesMap = new Map(state.messagesByChannel);
      newMessagesMap.set(channelId, updated);

      const newPendingMap = new Map(state.pendingMessages);
      newPendingMap.delete(idempotencyKey);

      return { messagesByChannel: newMessagesMap, pendingMessages: newPendingMap };
    }),

  markUncertain: (idempotencyKey) => set((state) => {
    const pending = state.pendingMessages.get(idempotencyKey);
    if (!pending) return state;
    const rows = state.messagesByChannel.get(pending.message.channelId) ?? [];
    const nextRows = rows.map((row) => row.id === pending.message.id
      ? { ...row, pending: false, failed: true, uncertain: true }
      : row);
    const next = new Map(state.messagesByChannel);
    next.set(pending.message.channelId, nextRows);
    return { messagesByChannel: next };
  }),

  markRetrying: (idempotencyKey, automatic) => set((state) => {
    const pending = state.pendingMessages.get(idempotencyKey);
    if (!pending) return state;
    const nextPending = new Map(state.pendingMessages);
    nextPending.set(idempotencyKey, { ...pending, autoRetried: pending.autoRetried || automatic });
    const rows = state.messagesByChannel.get(pending.message.channelId) ?? [];
    const nextRows = rows.map((row) => row.id === pending.message.id
      ? { ...row, pending: true, failed: false, uncertain: false }
      : row);
    const nextMessages = new Map(state.messagesByChannel);
    nextMessages.set(pending.message.channelId, nextRows);
    return { pendingMessages: nextPending, messagesByChannel: nextMessages };
  }),

  removePendingMessage: (idempotencyKey) => set((state) => {
    const pending = state.pendingMessages.get(idempotencyKey);
    if (!pending) return state;
    const nextPending = new Map(state.pendingMessages);
    nextPending.delete(idempotencyKey);
    const nextMessages = new Map(state.messagesByChannel);
    nextMessages.set(pending.message.channelId,
      (state.messagesByChannel.get(pending.message.channelId) ?? []).filter((row) => row.id !== pending.message.id));
    return { pendingMessages: nextPending, messagesByChannel: nextMessages };
  }),

  getPendingMessage: (idempotencyKey) => {
    return get().pendingMessages.get(idempotencyKey);
  },

  onMessageCreate: (message) =>
    set((state) => {
      // Keep loaded background transcripts and correlated sends current too.
      if (state.currentChannelId !== message.channelId &&
          !state.messagesByChannel.has(message.channelId) &&
          !state.pendingMessages.has(message.idempotencyKey ?? '')) return state;

      const existing = state.messagesByChannel.get(message.channelId) ?? [];

      // Only the sender's keyed broadcast may replace an optimistic row.
      // Author and content are not unique, even for consecutive sends.
      const correlated = message.idempotencyKey
        ? state.pendingMessages.get(message.idempotencyKey)
        : undefined;
      const optimisticIndex = correlated
        ? existing.findIndex((m) => m.id === correlated.message.id)
        : -1;
      let cleaned = existing;
      let pendingKeyToRemove: string | null = null;
      if (optimisticIndex >= 0) {
        const optimisticId = existing[optimisticIndex].id;
        cleaned = existing.filter((m) => m.id !== optimisticId);
        for (const [key, p] of state.pendingMessages) {
          if (p.message.id === optimisticId) {
            pendingKeyToRemove = key;
            break;
          }
        }
      }

      const confirmed = { ...message };
      delete confirmed.idempotencyKey;
      const index = cleaned.findIndex((m) => m.id === message.id);
      let updated: MessageResponse[];

      if (index >= 0) {
        // The confirmed broadcast for a message already on screen — server
        // wins: same id, but now with the real created stamp and a hydrated
        // author, unless a local edit/delete is still in flight.
        updated = [...cleaned];
        if (!updated[index]?.pending) updated[index] = confirmed;
      } else {
        // New message → the END of the ascending transcript, never the top.
        updated = [...cleaned, confirmed];
      }

      const newMap = new Map(state.messagesByChannel);
      newMap.set(message.channelId, trimLive(sortAscending(updated)));

      const newLastIds = advanceLastMessageId(
        state.lastMessageIds,
        message.channelId,
        message.id,
      );

      if (pendingKeyToRemove !== null) {
        const newPendingMap = new Map(state.pendingMessages);
        newPendingMap.delete(pendingKeyToRemove);
        return {
          messagesByChannel: newMap,
          pendingMessages: newPendingMap,
          lastMessageIds: newLastIds,
        };
      }
      return { messagesByChannel: newMap, lastMessageIds: newLastIds };
    }),

  onMessageUpdate: (message) =>
    set((state) => {
      const existing = state.messagesByChannel.get(message.channelId) ?? [];
      const index = existing.findIndex((m) => m.id === message.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = message;
      const newMap = new Map(state.messagesByChannel);
      newMap.set(message.channelId, updated);
      return { messagesByChannel: newMap };
    }),

  onMessageDelete: (payload) =>
    set((state) => {
      const existing = state.messagesByChannel.get(payload.channelId) ?? [];
      // Replace with deleted placeholder
      const index = existing.findIndex((m) => m.id === payload.id);
      if (index === -1) return state;

      const updated = [...existing];
      updated[index] = {
        ...updated[index],
        content: 'message deleted',
        isDeleted: true,
        pending: false,
      } as MessageResponse;
      
      const newMap = new Map(state.messagesByChannel);
      newMap.set(payload.channelId, updated);
      return { messagesByChannel: newMap };
    }),
}));
