import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import type { ServerRole } from '@/types/channel';

export function useMyRole(serverId: string | null): ServerRole | null {
  const myId = useAuthStore((s) => s.user?.id);
  const myRole = useServerStore((s) =>
    serverId ? (s.myRolesByServer[serverId] ?? null) : null,
  );
  const listServerMembers = useChannelStore((s) => s.listServerMembers);

  useEffect(() => {
    if (!serverId || !myId || myRole) return;

    listServerMembers(serverId)
      .then((members) => {
        const mine = members.find((m) => m.userId === myId);
        if (mine) {
          useServerStore.getState().setMyRole(serverId, mine.role);
        }
      })
      .catch(() => {});
  }, [serverId, myId, myRole, listServerMembers]);

  return myRole;
}
