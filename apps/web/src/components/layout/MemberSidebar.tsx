import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { authApi } from '@/api/auth';

interface Member {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: 'owner' | 'moderator' | 'member';
  isOnline: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function getStatusColor(isOnline: boolean): string {
  return isOnline ? 'bg-green-500' : 'bg-gray-500';
}

function getRoleBadge(role: Member['role']) {
  switch (role) {
    case 'owner':
      return (
        <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400 rounded-full">
          Owner
        </span>
      );
    case 'moderator':
      return (
        <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400 rounded-full">
          Mod
        </span>
      );
    default:
      return null;
  }
}

export function MemberSidebar() {
  const { currentServerId } = useServerStore();
  const { listServerMembers } = useChannelStore();
  const { isOnline, setSnapshot } = usePresenceStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentServerId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    let mounted = true;

    async function loadMembers() {
      try {
        setLoading(true);
        // currentServerId is guaranteed to be non-null here due to the check above
        const serverMembers = await listServerMembers(currentServerId!);
        const userIds = serverMembers.map((m) => m.userId);
        const users = await authApi.getUsers(userIds);

        // Create a map for quick lookup
        const userMap = new Map(users.map((u) => [u.user.id, u.user]));

        const enrichedMembers: Member[] = serverMembers.map((m) => {
          const user = userMap.get(m.userId);
          return {
            id: m.userId,
            username: user?.username ?? 'Unknown User',
            avatarUrl: user?.avatarUrl ?? null,
            role: m.role,
            isOnline: isOnline(m.userId),
          };
        });

        if (mounted) {
          setMembers(enrichedMembers);
          setSnapshot(userIds);
        }
      } catch (error) {
        console.error('Failed to load members:', error);
        if (mounted) {
          setMembers([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadMembers();

    return () => {
      mounted = false;
    };
  }, [currentServerId, listServerMembers, isOnline, setSnapshot]);

  useEffect(() => {
    if (!currentServerId) return;

    return () => {
      // Cleanup if needed
    };
  }, [currentServerId]);

  if (!currentServerId) {
    return (
      <div className="flex flex-col h-full w-64 bg-bg-base border-l border-border-subtle">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-sm">Select a server</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full w-64 bg-bg-base border-l border-border-subtle">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h2>
          <span className="text-text-muted text-xs animate-pulse">...</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse space-y-3 px-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-bg-raised" />
                <div className="flex-1 h-4 bg-bg-raised rounded w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const onlineMembers = members.filter((m) => m.isOnline);
  const offlineMembers = members.filter((m) => !m.isOnline);

  // Sort: owner first, then moderator, then member
  const sortByRole = (a: Member, b: Member) => {
    const roleOrder = { owner: 0, moderator: 1, member: 2 };
    return roleOrder[a.role] - roleOrder[b.role];
  };

  return (
    <div className={cn(
      'flex flex-col h-full bg-bg-base border-l border-border-subtle transition-all duration-200',
      'w-64',
      'lg:w-64'
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h2>
        <span className="text-text-muted text-xs">{members.length}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Members">
        {onlineMembers.length > 0 && (
          <>
            <h3 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Online ({onlineMembers.length})
            </h3>
            {onlineMembers.sort(sortByRole).map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg">
                <div className="relative">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
                      style={{ backgroundColor: getColorFromString(member.username) }}
                    >
                      {getInitials(member.username)}
                    </div>
                  )}
                  <span
                    className={cn(
                      'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg-base',
                      getStatusColor(member.isOnline)
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="truncate font-medium text-sm text-text-primary">{member.username}</span>
                  {getRoleBadge(member.role)}
                </div>
              </div>
            ))}
          </>
        )}
        {offlineMembers.length > 0 && (
          <>
            <h3 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Offline ({offlineMembers.length})
            </h3>
            {offlineMembers.sort(sortByRole).map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg">
                <div className="relative">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover opacity-50"
                    />
                  ) : (
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm opacity-50"
                      style={{ backgroundColor: getColorFromString(member.username) }}
                    >
                      {getInitials(member.username)}
                    </div>
                  )}
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg-base bg-gray-500" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="truncate font-medium text-sm text-text-secondary">{member.username}</span>
                  {getRoleBadge(member.role)}
                </div>
              </div>
            ))}
          </>
        )}
        {members.length === 0 && (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-text-muted text-sm">No members in this server</p>
          </div>
        )}
      </nav>
    </div>
  );
}