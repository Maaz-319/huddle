import { useCallback } from 'react';
import { useMyRole } from '@/hooks/useMyRole';
import { useAuthStore } from '@/stores/authStore';
import { useChannelStore } from '@/stores/channelStore';
import type { Capability, ServerRole } from '@/types/channel';

export interface MyPermissions {
  role: ServerRole | null;
  confirmed: boolean;
  hasRole: (...roles: ServerRole[]) => boolean;
  can: (capability: Capability) => boolean;
  canInChannel: (channelId: string, capability: Capability) => boolean;
}

/**
 * One presentation view for verified server authority and channel
 * capabilities. A channel capability is usable only when the current
 * user's channel response has been confirmed by the API.
 */
export function useMyPermissions(
  serverId: string | null,
  channelId: string | null = null,
): MyPermissions {
  const role = useMyRole(serverId);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const channelsByServer = useChannelStore((state) => state.channelsByServer);
  const verifiedChannelIds = useChannelStore((state) => state.verifiedChannelIds);
  const permissionUserId = useChannelStore((state) => state.permissionUserId);

  const confirmedFor = useCallback(
    (targetChannelId: string): boolean =>
      role !== null && userId !== null && permissionUserId === userId &&
      verifiedChannelIds.has(targetChannelId) &&
      (channelsByServer.get(serverId ?? '') ?? []).some(
        (channel) => channel.id === targetChannelId,
      ),
    [channelsByServer, permissionUserId, role, serverId, userId, verifiedChannelIds],
  );

  const hasRole = useCallback(
    (...roles: ServerRole[]) => role !== null && roles.includes(role),
    [role],
  );
  const canInChannel = useCallback(
    (targetChannelId: string, capability: Capability) => {
      if (!confirmedFor(targetChannelId)) return false;
      const channel = (channelsByServer.get(serverId ?? '') ?? [])
        .find((candidate) => candidate.id === targetChannelId);
      return channel?.myCapabilities.includes(capability) ?? false;
    },
    [channelsByServer, confirmedFor, serverId],
  );
  const confirmed = channelId === null
    ? role !== null
    : confirmedFor(channelId);
  const can = useCallback(
    (capability: Capability) =>
      channelId !== null && canInChannel(channelId, capability),
    [canInChannel, channelId],
  );

  return { role, confirmed, hasRole, can, canInChannel };
}
