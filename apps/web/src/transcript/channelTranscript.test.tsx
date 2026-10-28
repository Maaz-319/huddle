import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetChannel, useChannelTranscript, useTranscriptRuntime } from './channelTranscript';
import { useMessageStore } from './messageStore';
import { useAuthStore } from '@/stores/authStore';
import type { MessageResponse, SendAck } from '@/types/socket';

const harness = vi.hoisted(() => ({
  status: 'disconnected' as 'disconnected' | 'connected',
  emit: vi.fn(),
  get: vi.fn(),
  handlers: new Map<string, Set<(payload: unknown) => void>>(),
  post: vi.fn(),
}));

vi.mock('@/api/socket', () => ({
  getSocketStatus: () => harness.status,
  emitWithAck: harness.emit,
  onServerEvent: (event: string, handler: (payload: unknown) => void) => {
    const handlers = harness.handlers.get(event) ?? new Set();
    handlers.add(handler);
    harness.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  },
  SocketAckError: class SocketAckError extends Error {},
}));
vi.mock('@/hooks/useSocket', () => ({ useSocketStatus: () => harness.status }));
vi.mock('@/api/client', () => ({ apiClient: { get: harness.get, post: harness.post, patch: vi.fn(), delete: vi.fn() } }));

const CHANNEL = '890123456789012345';
const USER = {
  id: '880123456789012344', username: 'ada', avatarUrl: '',
  email: 'ada@example.com', bio: null,
};

function message(id: string, content = 'same'): MessageResponse {
  return {
    id, channelId: CHANNEL, authorId: USER.id,
    author: { id: USER.id, username: USER.username, avatarUrl: USER.avatarUrl },
    content, createdAt: '2026-01-01T00:00:00.000Z', editedAt: null,
    isDeleted: false,
  };
}

function broadcast(payload: MessageResponse): void {
  for (const handler of harness.handlers.get('message_create') ?? []) handler(payload);
}

function useRuntimeAndTranscript() {
  useTranscriptRuntime();
  return useChannelTranscript(CHANNEL);
}

describe('channel transcript lifecycle', () => {
  beforeEach(() => {
    harness.status = 'disconnected';
    harness.emit.mockReset();
    harness.get.mockReset().mockResolvedValue({ messages: [], hasMore: false });
    harness.post.mockReset();
    harness.handlers.clear();
    forgetChannel(CHANNEL);
    useAuthStore.setState({ user: USER });
  });

  it('keeps two identical sends distinct when broadcasts and acks cross', async () => {
    const acks = new Map<string, (ack: SendAck) => void>();
    harness.emit.mockImplementation((event: string, payload: { idempotencyKey: string }) => {
      if (event !== 'message_send') throw new Error(`unexpected ${event}`);
      return new Promise<SendAck>((resolve) => acks.set(payload.idempotencyKey, resolve));
    });
    const { result, rerender } = renderHook(useRuntimeAndTranscript);
    await act(async () => { await waitFor(() => expect(harness.get).toHaveBeenCalled()); });
    harness.status = 'connected';
    rerender();

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.sendMessage('same');
      second = result.current.sendMessage('same');
    });
    const keys = Array.from(useMessageStore.getState().pendingMessages.keys());
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);

    act(() => broadcast({ ...message('102'), idempotencyKey: keys[1] }));
    expect(useMessageStore.getState().getMessages(CHANNEL).filter((row) => row.id.startsWith('pending-'))).toHaveLength(1);
    await act(async () => {
      acks.get(keys[0])?.({ idempotencyKey: keys[0], messageId: '101', createdAt: message('101').createdAt });
      acks.get(keys[1])?.({ idempotencyKey: keys[1], messageId: '102', createdAt: message('102').createdAt });
      await Promise.all([first, second]);
    });
    act(() => broadcast({ ...message('101'), idempotencyKey: keys[0] }));
    expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['101', '102']);
    expect(useMessageStore.getState().pendingMessages.size).toBe(0);
  });

  it('coalesces channel opening and reconnect into one catch-up frame', async () => {
    useMessageStore.getState().addMessages(CHANNEL, [message('100')]);
    harness.status = 'connected';
    harness.emit.mockResolvedValue({ channels: [{ channelId: CHANNEL, messages: [message('101')], truncated: false }] });
    renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['100', '101']));
    expect(harness.emit.mock.calls.filter((call) => call[0] === 'catch_up')).toHaveLength(1);
  });

  it('ignores a late catch-up reply after channel access is removed', async () => {
    useMessageStore.getState().addMessages(CHANNEL, [message('100')]);
    harness.status = 'connected';
    let reply: (value: unknown) => void = () => {};
    harness.emit.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(harness.emit).toHaveBeenCalled());
    act(() => forgetChannel(CHANNEL));
    await act(async () => {
      reply({ channels: [{ channelId: CHANNEL, messages: [message('101')], truncated: false }] });
    });
    expect(useMessageStore.getState().getMessages(CHANNEL)).toEqual([]);
  });

  it('reloads the latest page after truncation and preserves an uncertain send', async () => {
    useMessageStore.getState().addMessages(CHANNEL, [message('100')]);
    useMessageStore.getState().addPendingMessage('local-key', {
      ...message('pending-local-key', 'draft'), pending: false, failed: true, uncertain: true,
    }, 'rest');
    harness.status = 'connected';
    harness.emit.mockResolvedValue({ channels: [{ channelId: CHANNEL, messages: [message('101')], truncated: true }] });
    harness.get.mockResolvedValue({ messages: [message('300')], hasMore: true });
    renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(useMessageStore.getState().getGap(CHANNEL)).toBe(true));
    expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['300', 'pending-local-key']);
    expect(useMessageStore.getState().getHasMore(CHANNEL)).toBe(true);
  });

  it('retries one uncertain socket send with its original key after reconnect', async () => {
    const store = useMessageStore.getState();
    store.addPendingMessage('original-key', {
      ...message('pending-original-key'), pending: true,
    }, 'socket');
    store.markUncertain('original-key');
    harness.emit.mockResolvedValue({ idempotencyKey: 'original-key', messageId: '200', createdAt: message('200').createdAt });
    const { rerender } = renderHook(useRuntimeAndTranscript);
    harness.status = 'connected';
    rerender();
    await waitFor(() => expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['200']));
    expect(harness.emit).toHaveBeenCalledWith('message_send', {
      channelId: CHANNEL, content: 'same', idempotencyKey: 'original-key',
    });
    expect(harness.emit.mock.calls.filter((call) => call[0] === 'message_send')).toHaveLength(1);
  });

  it('requires explicit confirmation to resend after the dedupe window', async () => {
    const store = useMessageStore.getState();
    store.addPendingMessage('expired-key', {
      ...message('pending-expired-key'), pending: true,
    }, 'socket');
    store.markUncertain('expired-key');
    const pending = store.getPendingMessage('expired-key');
    if (!pending) throw new Error('missing pending send');
    useMessageStore.setState({ pendingMessages: new Map([['expired-key', {
      ...pending, attemptedAt: Date.now() - 30_000,
    }]]) });
    harness.post.mockResolvedValue(message('201'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(useRuntimeAndTranscript);
    await act(async () => { await result.current.retryMessage('pending-expired-key'); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(harness.post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => { await result.current.retryMessage('pending-expired-key'); });
    expect(harness.post).toHaveBeenCalledWith(`/channels/${CHANNEL}/messages`, { content: 'same' });
    expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['201']);
    confirm.mockRestore();
  });

  it('shows a load failure and clears it when the user retries', async () => {
    harness.get.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(result.current.error).toContain('offline'));
    await act(async () => { await result.current.retrySync(); });
    expect(result.current.error).toBeNull();
  });

  it('retries the failed older page rather than refreshing the latest page', async () => {
    useMessageStore.getState().addMessages(CHANNEL, [message('100')]);
    const { result } = renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(harness.get.mock.calls.some((call) => String(call[0]).includes('after=100'))).toBe(true));
    await waitFor(() => expect(useMessageStore.getState().getLoading(CHANNEL)).toBe(false));
    harness.get.mockRejectedValueOnce(new Error('older page offline'));
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.error).toContain('older page offline');
    harness.get.mockResolvedValueOnce({ messages: [message('90')], hasMore: false });
    await act(async () => { await result.current.retrySync(); });
    expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['90', '100']);
    expect(harness.get.mock.calls.at(-1)?.[0]).toContain('before=100');
  });

  it('keeps a confirmed send that arrives while the initial page is loading', async () => {
    let finishHistory: (value: unknown) => void = () => {};
    harness.get.mockImplementationOnce(() => new Promise((resolve) => { finishHistory = resolve; }));
    harness.post.mockResolvedValue(message('200', 'new'));
    const { result } = renderHook(useRuntimeAndTranscript);
    await waitFor(() => expect(harness.get).toHaveBeenCalled());
    await act(async () => { await result.current.sendMessage('new'); });
    await act(async () => { finishHistory({ messages: [], hasMore: false }); });
    expect(useMessageStore.getState().getMessages(CHANNEL).map((row) => row.id)).toEqual(['200']);
  });
});
