import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelTranscript } from '@/transcript/channelTranscript';
import { useMessageStore } from './messageStore';
import { useAuthStore } from '@/stores/authStore';

const { emitMock, apiGetMock, apiPostMock, apiPatchMock, apiDeleteMock } = vi.hoisted(() => ({
  emitMock: vi.fn(() => Promise.resolve({ messageId: '0', createdAt: '' })),
  apiGetMock: vi.fn(() => Promise.resolve({ messages: [], hasMore: false })),
  apiPostMock: vi.fn(),
  apiPatchMock: vi.fn(),
  apiDeleteMock: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    emit: emitMock,
    emitNoAck: vi.fn(),
    on: () => () => {},
    isConnected: false,
    status: 'disconnected',
  }),
  useSocketStatus: () => 'disconnected',
}));

vi.mock('@/api/socket', () => ({
  getSocketStatus: () => 'disconnected',
  emitWithAck: emitMock,
  onServerEvent: () => () => {},
  SocketAckError: class SocketAckError extends Error {},
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: apiGetMock,
    post: apiPostMock,
    patch: apiPatchMock,
    put: vi.fn(),
    delete: apiDeleteMock,
  },
  isApiError: (error: unknown) => error instanceof Error && 'status' in error,
}));

const CHANNEL_ID = '890123456789012345';
const MESSAGE_ID = '900123456789012346';

const USER = {
  id: '880123456789012344',
  username: 'ada',
  avatarUrl: 'https://example.com/a.png',
  email: 'ada@example.com',
  bio: null,
};

function serverMessage(content: string) {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    authorId: USER.id,
    author: { id: USER.id, username: USER.username, avatarUrl: USER.avatarUrl },
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    editedAt: null,
    isDeleted: false,
  };
}

describe('channel transcript REST fallback while the socket is down', () => {
  beforeEach(() => {
    emitMock.mockClear();
    apiGetMock.mockClear().mockResolvedValue({ messages: [], hasMore: false });
    apiPostMock.mockReset();
    apiPatchMock.mockReset();
    apiDeleteMock.mockReset();
    useMessageStore.getState().clearChannel(CHANNEL_ID);
    useAuthStore.setState({ user: USER });
  });

  it('sends through REST and resolves the optimistic row under the server id', async () => {
    const created = serverMessage('hello');
    apiPostMock.mockResolvedValue(created);

    const { result } = renderHook(() => useChannelTranscript(CHANNEL_ID));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(emitMock).not.toHaveBeenCalled();
    expect(apiPostMock).toHaveBeenCalledWith(`/channels/${CHANNEL_ID}/messages`, {
      content: 'hello',
    });

    const rows = useMessageStore.getState().getMessages(CHANNEL_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(MESSAGE_ID);
    expect(rows[0]?.pending).toBe(false);
  });

  it('flags the row failed when the REST send rejects', async () => {
    apiPostMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useChannelTranscript(CHANNEL_ID));
    await act(async () => {
      await expect(result.current.sendMessage('hi')).rejects.toThrow('network down');
    });

    const rows = useMessageStore.getState().getMessages(CHANNEL_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failed).toBe(true);
    expect(rows[0]?.pending).toBe(false);
  });

  it('edits through REST and stores the returned message', async () => {
    const existing = serverMessage('old');
    apiPatchMock.mockResolvedValue({
      ...existing,
      content: 'new',
      editedAt: '2026-01-02T00:00:00.000Z',
    });

    const { result } = renderHook(() => useChannelTranscript(CHANNEL_ID));
    await act(async () => {
      useMessageStore.getState().addMessages(CHANNEL_ID, [existing]);
    });
    await act(async () => {
      await result.current.editMessage(MESSAGE_ID, 'new');
    });

    expect(apiPatchMock).toHaveBeenCalledWith(
      `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
      { content: 'new' },
    );
    expect(emitMock).not.toHaveBeenCalled();

    const rows = useMessageStore.getState().getMessages(CHANNEL_ID);
    expect(rows[0]?.content).toBe('new');
    expect(rows[0]?.pending).toBe(false);
  });

  it('deletes through REST and leaves the row as a tombstone', async () => {
    const existing = serverMessage('bye');
    apiDeleteMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChannelTranscript(CHANNEL_ID));
    await act(async () => {
      useMessageStore.getState().addMessages(CHANNEL_ID, [existing]);
    });
    await act(async () => {
      await result.current.deleteMessage(MESSAGE_ID);
    });

    expect(apiDeleteMock).toHaveBeenCalledWith(
      `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
    );
    expect(emitMock).not.toHaveBeenCalled();

    const rows = useMessageStore.getState().getMessages(CHANNEL_ID);
    expect(rows[0]?.isDeleted).toBe(true);
    expect(rows[0]?.content).toBe(null);
    expect(rows[0]?.pending).toBe(false);
  });
});
