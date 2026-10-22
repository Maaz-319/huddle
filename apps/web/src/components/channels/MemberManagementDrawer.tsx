import { useState, useEffect, useCallback, useMemo } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, UserPlus, UserMinus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/stores/toastStore';
import { useChannelStore } from '@/stores/channelStore';
import { authApi } from '@/api/auth';
import type { ChannelMemberResponse, ServerMemberResponse } from '@/types/channel';
import type { MeResponse } from '@/types/user';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getColorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

type ServerMemberRow = ServerMemberResponse & {
  username: string;
  avatarUrl: string | null;
};

type ChannelMemberRow = ChannelMemberResponse & {
  username: string;
  avatarUrl: string | null;
  role: 'owner' | 'moderator' | 'member';
};

interface MemberManagementDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  serverId: string;
}

export function MemberManagementDrawer({ open, onOpenChange, channelId, serverId }: MemberManagementDrawerProps) {
  const { listChannelMembers, addChannelMember, removeChannelMember, listServerMembers } = useChannelStore();

  const [channelMembers, setChannelMembers] = useState<ChannelMemberRow[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerMemberRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [channelRows, serverRows] = await Promise.all([
        listChannelMembers(channelId),
        listServerMembers(serverId),
      ]);
      const userIds = [...new Set([...channelRows.map((m) => m.userId), ...serverRows.map((m) => m.userId)])];
      const users: MeResponse[] = userIds.length > 0 ? await authApi.getUsers(userIds) : [];
      const userMap = new Map(users.map((u) => [u.id, u]));
      const roleByUser = new Map(serverRows.map((m) => [m.userId, m.role]));

      setChannelMembers(channelRows.map((m) => ({
        ...m,
        username: userMap.get(m.userId)?.username ?? 'Unknown user',
        avatarUrl: userMap.get(m.userId)?.avatarUrl ?? null,
        role: roleByUser.get(m.userId) ?? 'member',
      })));
      setServerMembers(serverRows.map((m) => ({
        ...m,
        username: userMap.get(m.userId)?.username ?? 'Unknown user',
        avatarUrl: userMap.get(m.userId)?.avatarUrl ?? null,
      })));
    } catch (error) {
      toast.error('Failed to load members', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [channelId, serverId, listChannelMembers, listServerMembers]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAll();
    }
  }, [open, loadAll]);

  const availableUsers = useMemo(
    () => serverMembers.filter((u) => !channelMembers.some((m) => m.userId === u.userId)),
    [serverMembers, channelMembers],
  );

  const filteredAvailableUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddMember = async (userId: string) => {
    setAdding(userId);
    try {
      await addChannelMember(channelId, userId);
      toast.success('Member added');
      loadAll();
    } catch (error) {
      toast.error('Failed to add member', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setAdding(null);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Remove this member from the channel?')) return;
    
    setRemoving(userId);
    try {
      await removeChannelMember(channelId, userId);
      toast.success('Member removed');
      loadAll();
    } catch (error) {
      toast.error('Failed to remove member', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <RadixDialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-bg-raised border-l border-border-subtle shadow-xl flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <div className="flex h-16 shrink-0 items-center justify-between px-4 border-b border-border-subtle">
            <RadixDialog.Title className="text-text-primary font-semibold truncate">
              Manage Members
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </RadixDialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* Current Members */}
          <div className="mb-6">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">
              Current Members ({channelMembers.length})
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              </div>
            ) : channelMembers.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-4">No members yet</p>
            ) : (
              <div className="space-y-2">
                {channelMembers.map(member => (
                  <div key={member.userId} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-overlay rounded-lg">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
                      style={{ backgroundColor: getColorFromString(member.username) }}>
                      {getInitials(member.username)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary font-medium truncate">{member.username}</p>
                      <p className="text-text-muted text-xs capitalize">{member.role}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-accent-warn hover:text-accent-warn"
                      onClick={() => handleRemoveMember(member.userId)}
                      disabled={removing === member.userId}
                      aria-label="Remove member"
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Members */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                Add Members
              </h3>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                <Input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            {filteredAvailableUsers.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-4">
                {searchQuery ? 'No matching users' : 'All server members are already in this channel'}
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {filteredAvailableUsers.map(user => (
                  <div key={user.userId} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-overlay rounded-lg">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
                      style={{ backgroundColor: getColorFromString(user.username) }}>
                      {getInitials(user.username)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary font-medium truncate">{user.username}</p>
                      <p className="text-text-muted text-xs capitalize">{user.role}</p>
                    </div>
                    <Button
                      variant="primary"
                      size="icon"
                      onClick={() => handleAddMember(user.userId)}
                      disabled={adding === user.userId}
                      aria-label="Add member"
                    >
                      {adding === user.userId ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}