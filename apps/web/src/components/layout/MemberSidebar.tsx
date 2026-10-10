import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/components/ui/cn';
import { Search, X } from 'lucide-react';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { authApi } from '@/api/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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

function MemberItem({ member }: { member: Member }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg">
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
  );
}



export function MemberSidebar() {
  const { currentServerId } = useServerStore();
  const { listServerMembers } = useChannelStore();
  const { isOnline, setSnapshot } = usePresenceStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

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
        const serverMembers = await listServerMembers(currentServerId!);
        const userIds = serverMembers.map((m) => m.userId);
        const users = await authApi.getUsers(userIds);

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

  // Filter members based on search query
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter((m) => m.username.toLowerCase().includes(query));
  }, [members, searchQuery]);

  // Sort: online first, then by role (owner > moderator > member)
  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      // Online first
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      // Then by role
      const roleOrder = { owner: 0, moderator: 1, member: 2 };
      return roleOrder[a.role] - roleOrder[b.role];
    });
  }, [filteredMembers]);

  // Virtualizer for large member lists
  const virtualizer = useVirtualizer({
    count: sortedMembers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

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

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
  }, []);

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

      {/* Search input */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <Input
            type="text"
            placeholder="Search members..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-9 pr-8 py-1.5 text-sm bg-bg-raised border-border-subtle"
            aria-label="Search members"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-text-muted hover:text-text-primary"
              onClick={handleSearchClear}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Member list */}
      <nav
        ref={parentRef}
        className="flex-1 overflow-y-auto px-2 py-2 space-y-1"
        role="navigation"
        aria-label="Members"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {sortedMembers.length === 0 && (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-text-muted text-sm">
              {searchQuery ? 'No members match your search' : 'No members in this server'}
            </p>
          </div>
        )}

        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={sortedMembers[virtualRow.index]?.id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {sortedMembers[virtualRow.index] && (
              <MemberItem member={sortedMembers[virtualRow.index]} />
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}