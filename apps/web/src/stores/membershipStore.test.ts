import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMembershipStore } from './membershipStore';
import { useAuthStore } from './authStore';
import { useMyRole } from '@/hooks/useMyRole';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useChannelStore } from './channelStore';
import type { ServerMemberResponse } from '@/types/channel';

const calls = vi.hoisted(() => ({ get: vi.fn(), getUsers: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { get: calls.get } }));
vi.mock('@/api/auth', () => ({ authApi: { getUsers: calls.getUsers } }));

const serverId = '900000000000000001';
const userId = '900000000000000002';
const row = { userId, role: 'member' as const, joinedAt: '2026-01-01T00:00:00.000Z' };
const profile = { id: userId, username: 'Ada', avatarUrl: '', bio: 'Hello', email: 'ada@example.com' };

describe('server membership view', () => {
  beforeEach(() => {
    useMembershipStore.getState().clear();
    useChannelStore.getState().clear();
    useAuthStore.setState({ user: profile });
    calls.get.mockReset().mockResolvedValue([row]);
    calls.getUsers.mockReset().mockResolvedValue([profile]);
  });

  it('deduplicates simultaneous reads and enriches the shared view', async () => {
    const store = useMembershipStore.getState();
    await Promise.all([store.refresh(serverId), store.refresh(serverId)]);
    expect(calls.get).toHaveBeenCalledTimes(1);
    expect(calls.getUsers).toHaveBeenCalledWith([userId]);
    expect(useMembershipStore.getState().byServer[serverId]).toMatchObject({
      verified: true, error: null,
      members: [{ id: userId, role: 'member', username: 'Ada', bio: 'Hello' }],
    });
  });

  it('keeps the last verified view during refresh, then hides it on failure', async () => {
    await useMembershipStore.getState().refresh(serverId);
    let rejectRefresh: (error: Error) => void = () => {};
    calls.get.mockImplementationOnce(() => new Promise<ServerMemberResponse[]>((_, reject) => { rejectRefresh = reject; }));
    const refresh = useMembershipStore.getState().refresh(serverId);
    expect(useMembershipStore.getState().byServer[serverId]).toMatchObject({
      loading: true,
      verified: true,
    });
    rejectRefresh(new Error('offline'));
    await refresh;
    expect(useMembershipStore.getState().byServer[serverId]).toMatchObject({
      verified: false, error: 'offline', members: [{ username: 'Ada' }],
    });
  });

  it('ignores a stale reply after invalidation', async () => {
    let resolveOld: (value: ServerMemberResponse[]) => void = () => {};
    calls.get.mockImplementationOnce(() => new Promise<ServerMemberResponse[]>((resolve) => { resolveOld = resolve; }));
    const first = useMembershipStore.getState().refresh(serverId);
    calls.get.mockResolvedValueOnce([{ ...row, role: 'moderator' }]);
    useMembershipStore.getState().invalidate(serverId);
    await useMembershipStore.getState().refresh(serverId);
    resolveOld([row]);
    await first;
    expect(useMembershipStore.getState().byServer[serverId].members[0].role).toBe('moderator');
  });

  it('derives my role from the verified view and hides it during refresh', async () => {
    const { result } = renderHook(() => useMyRole(serverId));
    await waitFor(() => expect(result.current).toBe('member'));
    let resolve: (value: ServerMemberResponse[]) => void = () => {};
    calls.get.mockImplementationOnce(() => new Promise<ServerMemberResponse[]>((done) => { resolve = done; }));
    act(() => useMembershipStore.getState().invalidate(serverId));
    expect(result.current).toBeNull();
    await act(async () => { resolve([{ ...row, role: 'moderator' }]); });
    await waitFor(() => expect(result.current).toBe('moderator'));
  });

  it('exposes channel capabilities only after both role and channel data are verified', async () => {
    const channelId = '900000000000000003';
    const { result } = renderHook(() => useMyPermissions(serverId, channelId));

    await waitFor(() => expect(result.current.role).toBe('member'));
    expect(result.current.confirmed).toBe(false);
    expect(result.current.can('post')).toBe(false);

    act(() => {
      useChannelStore.setState({
        channelsByServer: new Map([[serverId, [{
          id: channelId,
          serverId,
          name: 'general',
          isPrivate: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          myCapabilities: ['view', 'manage_settings'],
        }]]]),
        verifiedChannelIds: new Set([channelId]),
        permissionUserId: userId,
      });
    });

    expect(result.current.confirmed).toBe(true);
    expect(result.current.can('view')).toBe(true);
    expect(result.current.can('manage_settings')).toBe(true);
    expect(result.current.can('post')).toBe(false);
    expect(result.current.hasRole('owner')).toBe(false);

    let resolveRefresh: (value: ServerMemberResponse[]) => void = () => {};
    calls.get.mockImplementationOnce(() => new Promise<ServerMemberResponse[]>((resolve) => { resolveRefresh = resolve; }));
    let pendingRefresh: Promise<void> = Promise.resolve();
    act(() => { pendingRefresh = useMembershipStore.getState().refresh(serverId); });
    expect(result.current.can('manage_settings')).toBe(true);
    await act(async () => {
      resolveRefresh([row]);
      await pendingRefresh;
    });
    expect(result.current.can('manage_settings')).toBe(true);

    act(() => useAuthStore.setState({ user: { ...profile, id: '900000000000000004' } }));
    expect(result.current.confirmed).toBe(false);
    expect(result.current.hasRole('owner')).toBe(false);

    act(() => useChannelStore.getState().clear());
    expect(result.current.confirmed).toBe(false);
    expect(result.current.can('view')).toBe(false);
  });
});
