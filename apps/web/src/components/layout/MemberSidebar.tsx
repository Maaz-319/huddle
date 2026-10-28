import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/components/ui/cn';
import { Search, X, Settings } from 'lucide-react';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { apiClient } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PopoverRoot, PopoverTrigger } from '@/components/ui/popover';
import { MemberProfileCard } from './MemberProfileCard';
import { getInitials, getColorFromString } from '@/utils/avatar';

interface Member {
  id: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: string;
}

function getRoleBadge(role: Member['role']) {
  switch (role) {
    case 'owner':
      return (
        <span className="rounded-full bg-accent-owner/10 px-1.5 py-0.5 text-xs font-medium text-accent-owner">
          Owner
        </span>
      );
    case 'moderator':
      return (
        <span className="rounded-full bg-accent-info/10 px-1.5 py-0.5 text-xs font-medium text-accent-info">
          Mod
        </span>
      );
    default:
      return null;
  }
}

function MemberItem({ member, isOnline }: { member: Member; isOnline: boolean }) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-electric/40"
        >
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
                'absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-bg-base',
                isOnline ? 'bg-accent-primary' : 'bg-accent-offline'
              )}
            />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="truncate font-medium text-sm text-text-primary">{member.username}</span>
            {getRoleBadge(member.role)}
          </div>
        </button>
      </PopoverTrigger>
      <MemberProfileCard
        username={member.username}
        avatarUrl={member.avatarUrl}
        roleBadge={getRoleBadge(member.role)}
        bio={member.bio}
        joinedAt={member.joinedAt}
        isOnline={isOnline}
      />
    </PopoverRoot>
  );
}

function UserCard() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <div className="shrink-0 border-t border-border-subtle p-2">
      <button
        onClick={() => navigate({ to: '/app/settings' })}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-raised transition-colors text-left"
        aria-label="Open your settings"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
            style={{ backgroundColor: getColorFromString(user.username) }}
          >
            {getInitials(user.username)}
          </div>
        )}
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-text-primary">
          {user.username}
        </span>
        <Settings className="h-4 w-4 text-text-muted" aria-hidden="true" />
      </button>
    </div>
  );
}

export function MemberSidebar() {
  const { currentServerId } = useServerStore();
  const { listServerMembers } = useChannelStore();
  const setSnapshot = usePresenceStore((s) => s.setSnapshot);
  const onlineUserIds = usePresenceStore((s) => s.onlineUserIds);
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

        const userMap = new Map(users.map((u) => [u.id, u]));

        const enrichedMembers: Member[] = serverMembers.map((m) => {
          const user = userMap.get(m.userId);
          return {
            id: m.userId,
            username: user?.username ?? 'Unknown User',
            avatarUrl: user?.avatarUrl ?? null,
            bio: user?.bio ?? null,
            role: m.role,
            joinedAt: m.joinedAt,
          };
        });

        if (mounted) {
          setMembers(enrichedMembers);
          // Snapshot only the subset that is actually online — seeding the
          // set with every member id would render everyone green.
          if (userIds.length > 0) {
            try {
              const snapshot = await apiClient.get<{ online: string[] }>(
                `/presence/snapshot?userIds=${userIds.join(',')}`
              );
              if (mounted) setSnapshot(snapshot.online);
            } catch (presenceError) {
              // Presence is cosmetic; the member list still stands.
              console.error('Failed to load presence snapshot:', presenceError);
              if (mounted) setSnapshot([]);
            }
          } else {
            setSnapshot([]);
          }
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
  }, [currentServerId, listServerMembers, setSnapshot]);

  // Filter members based on search query
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter((m) => m.username.toLowerCase().includes(query));
  }, [members, searchQuery]);

  // Sort: online first (live, without refetching), then by role
  const sortedMembers = useMemo(() => {
    const roleOrder = { owner: 0, moderator: 1, member: 2 } as const;
    return [...filteredMembers].sort((a, b) => {
      const aOnline = onlineUserIds.has(a.id);
      const bOnline = onlineUserIds.has(b.id);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return roleOrder[a.role] - roleOrder[b.role];
    });
  }, [filteredMembers, onlineUserIds]);

  // Virtualizer for large member lists
  const virtualizer = useVirtualizer({
    count: sortedMembers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  if (!currentServerId) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-base border-l border-border-subtle">
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
      <div className="flex flex-col h-full w-full bg-bg-base border-l border-border-subtle">
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

  return (
    <div className="flex flex-col h-full w-full bg-bg-base border-l border-border-subtle">
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
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 py-1.5 text-sm bg-bg-raised border-border-subtle"
            aria-label="Search members"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-text-muted hover:text-text-primary"
              onClick={() => setSearchQuery('')}
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
        className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
        role="navigation"
        aria-label="Members"
      >
        {sortedMembers.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-4">
            <p className="text-text-muted text-sm">
              {searchQuery ? 'No members match your search' : 'No members in this server'}
            </p>
          </div>
        ) : (
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const member = sortedMembers[virtualRow.index];
              if (!member) return null;
              return (
                <div
                  key={member.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MemberItem member={member} isOnline={onlineUserIds.has(member.id)} />
                </div>
              );
            })}
          </div>
        )}
      </nav>
      <UserCard />
    </div>
  );
}
