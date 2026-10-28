import { useCallback, useEffect } from 'react';
import { apiClient, isApiError } from '@/api/client';
import { emitWithAck, getSocketStatus, onServerEvent, SocketAckError } from '@/api/socket';
import { useAuthStore } from '@/stores/authStore';
import { useMessageStore } from './messageStore';
import { useSocketStatus } from '@/hooks/useSocket';
import { crypto } from '@/utils/crypto';
import type { CatchUpChannelResponse, MessageResponse } from '@/types/socket';

interface MessagePage {
  messages: MessageResponse[];
  hasMore: boolean;
}

const HISTORY_LIMIT = 50;
const CATCH_UP_FRAME_CHANNELS = 200;
// Redis retains a send key for 30 seconds. Leave room for network transit.
const SAFE_RETRY_MS = 29_000;
const EMPTY_MESSAGES: MessageResponse[] = [];
const generations = new Map<string, number>();
const recentRequests = new Map<string, number>();
const syncFlights = new Map<string, Promise<void>>();
const retryOperations = new Map<string, () => Promise<void>>();
const syncQueue = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();
let syncScheduled = false;

function generation(channelId: string): number {
  return generations.get(channelId) ?? 0;
}

function invalidate(channelId: string): number {
  const next = generation(channelId) + 1;
  generations.set(channelId, next);
  return next;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load messages';
}

async function getHistory(channelId: string, options?: { before?: string; after?: string; limit?: number }): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (options?.before) params.set('before', options.before);
  if (options?.after) params.set('after', options.after);
  if (options?.limit) params.set('limit', String(options.limit));
  return apiClient.get<MessagePage>(`/channels/${channelId}/messages?${params.toString()}`);
}

async function loadRecent(channelId: string, gap = false): Promise<void> {
  const token = generation(channelId);
  const request = (recentRequests.get(channelId) ?? 0) + 1;
  recentRequests.set(channelId, request);
  const isCurrent = () => generation(channelId) === token && recentRequests.get(channelId) === request;
  const store = useMessageStore.getState();
  const retainedAfter = store.getLastMessageId(channelId);
  store.setLoading(channelId, true);
  try {
    const page = await getHistory(channelId, { limit: HISTORY_LIMIT });
    if (!isCurrent()) return;
    store.replaceRecent(channelId, page.messages, page.hasMore, retainedAfter);
    store.setGap(channelId, gap);
    store.setError(channelId, null);
    retryOperations.delete(channelId);
  } catch (error) {
    if (isCurrent()) {
      store.setError(channelId, `Could not load messages: ${errorText(error)}`);
      retryOperations.set(channelId, () => loadRecent(channelId, gap));
    }
    throw error;
  } finally {
    if (isCurrent()) store.setLoading(channelId, false);
  }
}

async function loadOlder(channelId: string): Promise<void> {
  const store = useMessageStore.getState();
  if (store.getLoading(channelId) || !store.getHasMore(channelId)) return;
  const first = store.getMessages(channelId).find((message) => /^\d+$/.test(message.id));
  if (!first) return;
  const token = generation(channelId);
  store.setLoading(channelId, true);
  try {
    const page = await getHistory(channelId, { before: first.id, limit: HISTORY_LIMIT });
    if (generation(channelId) !== token) return;
    store.prependMessages(channelId, page.messages);
    store.setHasMore(channelId, page.hasMore);
    store.setError(channelId, null);
    retryOperations.delete(channelId);
  } catch (error) {
    if (generation(channelId) === token) {
      store.setError(channelId, `Could not load older messages: ${errorText(error)}`);
      retryOperations.set(channelId, () => loadOlder(channelId));
    }
  } finally {
    if (generation(channelId) === token) store.setLoading(channelId, false);
  }
}

async function applyCatchUp(entry: CatchUpChannelResponse, token: number): Promise<void> {
  if (generation(entry.channelId) !== token) return;
  if (entry.truncated) {
    await loadRecent(entry.channelId, true);
  } else {
    const store = useMessageStore.getState();
    store.addMessages(entry.channelId, entry.messages);
    store.setError(entry.channelId, null);
    retryOperations.delete(entry.channelId);
  }
}

async function flushSync(): Promise<void> {
  syncScheduled = false;
  const queued = Array.from(syncQueue.entries());
  syncQueue.clear();
  for (let index = 0; index < queued.length; index += CATCH_UP_FRAME_CHANNELS) {
    const batch = queued.slice(index, index + CATCH_UP_FRAME_CHANNELS);
    const cursors = batch.map(([channelId]) => ({
      channelId,
      afterMessageId: useMessageStore.getState().getLastMessageId(channelId),
      token: generation(channelId),
    }));
    try {
      let outcomes: PromiseSettledResult<void>[];
      if (getSocketStatus() === 'connected') {
        const requested = cursors.filter((cursor) => cursor.afterMessageId !== null).map((cursor) => ({
          channelId: cursor.channelId,
          afterMessageId: cursor.afterMessageId,
        }));
        const reply = requested.length > 0
          ? await emitWithAck('catch_up', { channels: requested }, 30_000)
          : { channels: [] };
        const entries = new Map(reply.channels.map((entry) => [entry.channelId, entry]));
        outcomes = await Promise.allSettled(cursors.map(async (cursor) => {
          if (cursor.afterMessageId === null) return loadRecent(cursor.channelId);
          const entry = entries.get(cursor.channelId);
          if (!entry) {
            // The server omits inaccessible channels rather than disclosing them.
            forgetChannel(cursor.channelId);
            return;
          }
          await applyCatchUp(entry, cursor.token);
        }));
      } else {
        // REST can bridge a short gap. A long gap needs a fresh latest page.
        outcomes = await Promise.allSettled(cursors.map(async (cursor) => {
          if (!cursor.afterMessageId) return loadRecent(cursor.channelId);
          const page = await getHistory(cursor.channelId, { after: cursor.afterMessageId, limit: 100 });
          if (generation(cursor.channelId) !== cursor.token) return;
          if (page.hasMore) await loadRecent(cursor.channelId, true);
          else {
            useMessageStore.getState().addMessages(cursor.channelId, page.messages);
            useMessageStore.getState().setError(cursor.channelId, null);
            retryOperations.delete(cursor.channelId);
          }
        }));
      }
      batch.forEach(([channelId, deferred], position) => {
        const result = outcomes[position];
        if (result?.status === 'fulfilled') deferred.resolve();
        else {
          const error = result?.reason ?? new Error('No sync result');
          if (generation(channelId) === cursors[position]?.token) {
            useMessageStore.getState().setError(channelId, `Could not sync messages: ${errorText(error)}`);
            retryOperations.set(channelId, () => syncChannel(channelId));
          }
          deferred.reject(error);
        }
      });
    } catch (error) {
      batch.forEach(([channelId, deferred]) => {
        if (generation(channelId) === cursors.find((cursor) => cursor.channelId === channelId)?.token) {
          useMessageStore.getState().setError(channelId, `Could not sync messages: ${errorText(error)}`);
          retryOperations.set(channelId, () => syncChannel(channelId));
        }
        deferred.reject(error);
      });
    }
  }
}

function syncChannel(channelId: string): Promise<void> {
  const existing = syncFlights.get(channelId);
  if (existing) return existing;
  const flight = new Promise<void>((resolve, reject) => {
    syncQueue.set(channelId, { resolve, reject });
    if (!syncScheduled) {
      syncScheduled = true;
      queueMicrotask(() => { void flushSync(); });
    }
  });
  syncFlights.set(channelId, flight);
  void flight.finally(() => { if (syncFlights.get(channelId) === flight) syncFlights.delete(channelId); }).catch(() => {});
  return flight;
}

async function syncAll(): Promise<void> {
  await Promise.allSettled(Array.from(useMessageStore.getState().lastMessageIds.keys()).map(syncChannel));
}

export function forgetChannel(channelId: string): void {
  invalidate(channelId);
  recentRequests.delete(channelId);
  retryOperations.delete(channelId);
  const store = useMessageStore.getState();
  store.clearChannel(channelId);
  if (store.currentChannelId === channelId) store.setCurrentChannelId(null);
}

function pendingKeyFor(channelId: string, messageId: string): string | null {
  for (const [key, pending] of useMessageStore.getState().pendingMessages) {
    if (pending.message.channelId === channelId && pending.message.id === messageId) return key;
  }
  return null;
}

async function sendWithKey(channelId: string, content: string, key: string): Promise<void> {
  const store = useMessageStore.getState();
  try {
    const ack = await emitWithAck('message_send', { channelId, content, idempotencyKey: key });
    const pending = store.getPendingMessage(key);
    if (!pending) return; // Its correlated broadcast already won the race.
    store.resolvePendingMessage(key, {
      ...pending.message,
      id: ack.messageId,
      createdAt: ack.createdAt,
      pending: false,
      failed: false,
      uncertain: false,
    });
  } catch (error) {
    if (!store.getPendingMessage(key)) return;
    // An INTERNAL_ERROR can happen after the database write but before the
    // ephemeral dedupe result is filed. Treat it as uncertain despite the
    // server's non-retryable classification.
    if (error instanceof SocketAckError && !error.retryable && error.message !== 'INTERNAL_ERROR') store.rejectPendingMessage(key);
    else store.markUncertain(key);
    throw error;
  }
}

async function sendMessage(channelId: string, content: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  const key = crypto.randomUUID();
  const transport = getSocketStatus() === 'connected' ? 'socket' : 'rest';
  useMessageStore.getState().addPendingMessage(key, {
    id: `pending-${key}`, channelId, authorId: user.id,
    author: { id: user.id, username: user.username, avatarUrl: user.avatarUrl },
    content, createdAt: new Date().toISOString(), editedAt: null,
    isDeleted: false, pending: true,
    retryExpiresAt: transport === 'socket' ? Date.now() + SAFE_RETRY_MS : undefined,
  }, transport);
  if (transport === 'socket') return sendWithKey(channelId, content, key);
  try {
    const created = await apiClient.post<MessageResponse>(`/channels/${channelId}/messages`, { content });
    useMessageStore.getState().resolvePendingMessage(key, { ...created, pending: false });
  } catch (error) {
    // A network or server failure can hide a completed write. A 4xx response
    // definitively refused the send before the write.
    if (isApiError(error) && error.status >= 400 && error.status < 500) {
      useMessageStore.getState().rejectPendingMessage(key);
    } else {
      useMessageStore.getState().markUncertain(key);
    }
    throw error;
  }
}

async function retryMessage(channelId: string, messageId: string): Promise<void> {
  const key = pendingKeyFor(channelId, messageId);
  const store = useMessageStore.getState();
  if (!key) {
    const failed = store.getMessages(channelId).find((message) => message.id === messageId);
    if (failed?.failed && failed.content) {
      store.removeMessage(channelId, messageId);
      await sendMessage(channelId, failed.content);
    }
    return;
  }
  const pending = store.getPendingMessage(key);
  if (!pending || !pending.message.content) return;
  if (pending.transport === 'socket' && Date.now() - pending.attemptedAt < SAFE_RETRY_MS && getSocketStatus() === 'connected') {
    store.markRetrying(key, false);
    return sendWithKey(channelId, pending.message.content, key);
  }
  if (!window.confirm('The first message may already have been sent. Resending may create a duplicate. Resend anyway?')) return;
  store.removePendingMessage(key);
  await sendMessage(channelId, pending.message.content);
}

async function retryUncertainOnReconnect(): Promise<void> {
  const entries = Array.from(useMessageStore.getState().pendingMessages.values());
  await Promise.allSettled(entries.map(async (entry) => {
    const live = useMessageStore.getState().getPendingMessage(entry.idempotencyKey);
    const row = live && useMessageStore.getState().getMessages(live.message.channelId)
      .find((message) => message.id === live.message.id);
    if (!live || live.transport !== 'socket' || live.autoRetried ||
      !row?.uncertain || Date.now() - live.attemptedAt >= SAFE_RETRY_MS || getSocketStatus() !== 'connected') return;
    useMessageStore.getState().markRetrying(live.idempotencyKey, true);
    await sendWithKey(live.message.channelId, live.message.content ?? '', live.idempotencyKey);
  }));
}

async function editMessage(channelId: string, messageId: string, content: string): Promise<void> {
  const store = useMessageStore.getState();
  const previous = store.getMessages(channelId).find((message) => message.id === messageId);
  if (!previous) return;
  store.updateMessage(channelId, { ...previous, content, editedAt: new Date().toISOString(), pending: true });
  try {
    if (getSocketStatus() === 'connected') {
      const ack = await emitWithAck('message_edit', { channelId, messageId, content, idempotencyKey: crypto.randomUUID() });
      const current = store.getMessages(channelId).find((message) => message.id === messageId);
      if (current?.pending) store.updateMessage(channelId, { ...current, editedAt: ack.editedAt, pending: false });
    } else {
      const updated = await apiClient.patch<MessageResponse>(`/channels/${channelId}/messages/${messageId}`, { content });
      store.updateMessage(channelId, { ...updated, pending: false });
    }
  } catch (error) {
    if (store.getMessages(channelId).find((message) => message.id === messageId)?.pending) store.updateMessage(channelId, previous);
    throw error;
  }
}

async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  const store = useMessageStore.getState();
  const previous = store.getMessages(channelId).find((message) => message.id === messageId);
  if (!previous) return;
  store.updateMessage(channelId, { ...previous, content: null, isDeleted: true, pending: true });
  try {
    if (getSocketStatus() === 'connected') {
      await emitWithAck('message_delete', { channelId, messageId, idempotencyKey: crypto.randomUUID() });
      const current = store.getMessages(channelId).find((message) => message.id === messageId);
      if (current?.pending) store.updateMessage(channelId, { ...current, pending: false });
    } else {
      await apiClient.delete(`/channels/${channelId}/messages/${messageId}`);
      store.updateMessage(channelId, { ...previous, content: null, isDeleted: true, pending: false });
    }
  } catch (error) {
    if (store.getMessages(channelId).find((message) => message.id === messageId)?.pending) store.updateMessage(channelId, previous);
    throw error;
  }
}

export function useTranscriptRuntime(): void {
  const status = useSocketStatus();
  useEffect(() => {
    const offCreate = onServerEvent('message_create', (message) => useMessageStore.getState().onMessageCreate(message));
    const offUpdate = onServerEvent('message_update', (message) => useMessageStore.getState().onMessageUpdate(message));
    const offDelete = onServerEvent('message_delete', (message) => useMessageStore.getState().onMessageDelete(message));
    return () => { offCreate(); offUpdate(); offDelete(); };
  }, []);
  useEffect(() => {
    if (status !== 'connected') return;
    void (async () => {
      await syncAll();
      await retryUncertainOnReconnect();
    })();
  }, [status]);
}

export function useChannelTranscript(channelId: string | null) {
  const messages = useMessageStore((state) => state.messagesByChannel.get(channelId ?? '') ?? EMPTY_MESSAGES);
  const hasMore = useMessageStore((state) => state.hasMoreByChannel.get(channelId ?? '') ?? true);
  const loading = useMessageStore((state) => state.loadingByChannel.get(channelId ?? '') ?? false);
  const error = useMessageStore((state) => state.errorByChannel.get(channelId ?? '') ?? null);
  const gap = useMessageStore((state) => state.gapByChannel.get(channelId ?? '') ?? false);
  useEffect(() => {
    useMessageStore.getState().setCurrentChannelId(channelId);
    if (channelId) void syncChannel(channelId).catch(() => {});
    return () => { useMessageStore.getState().setCurrentChannelId(null); };
  }, [channelId]);

  const retrySync = useCallback(async () => {
    if (!channelId) return;
    const retry = retryOperations.get(channelId);
    if (retry) return retry();
    if (useMessageStore.getState().getLastMessageId(channelId)) await syncChannel(channelId);
    else await loadRecent(channelId);
  }, [channelId]);

  return {
    messages, hasMore, loading, error, gap, retrySync,
    sendMessage: useCallback((content: string) => channelId ? sendMessage(channelId, content) : Promise.resolve(), [channelId]),
    retryMessage: useCallback((messageId: string) => channelId ? retryMessage(channelId, messageId) : Promise.resolve(), [channelId]),
    discardFailedMessage: useCallback((messageId: string) => {
      if (!channelId) return;
      const key = pendingKeyFor(channelId, messageId);
      if (key) useMessageStore.getState().removePendingMessage(key);
      else useMessageStore.getState().removeMessage(channelId, messageId);
    }, [channelId]),
    editMessage: useCallback((messageId: string, content: string) => channelId ? editMessage(channelId, messageId, content) : Promise.resolve(), [channelId]),
    deleteMessage: useCallback((messageId: string) => channelId ? deleteMessage(channelId, messageId) : Promise.resolve(), [channelId]),
    loadOlder: useCallback(() => channelId ? loadOlder(channelId) : Promise.resolve(), [channelId]),
  };
}
