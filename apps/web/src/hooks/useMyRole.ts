import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useMembershipStore } from '@/stores/membershipStore';
import type { ServerRole } from '@/types/channel';

export function useMyRole(serverId: string | null): ServerRole | null {
  const myId = useAuthStore((state) => state.user?.id);
  const entry = useMembershipStore((state) => serverId ? state.byServer[serverId] : undefined);
  const refresh = useMembershipStore((state) => state.refresh);

  useEffect(() => {
    if (serverId && myId) void refresh(serverId);
  }, [serverId, myId, refresh]);

  return entry?.verified ? entry.members.find((member) => member.userId === myId)?.role ?? null : null;
}
