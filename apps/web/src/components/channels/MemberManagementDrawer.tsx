import { useState, useEffect, useCallback } from 'react';
import { X, UserPlus, UserMinus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/stores/toastStore';
import { useChannelStore } from '@/stores/channelStore';
import { useServerStore } from '@/stores/serverStore';
import type { ChannelMemberResponse } from '@/types/channel';

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

type ChannelMember = ChannelMemberResponse & {
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
  const { listChannelMembers, addChannelMember, removeChannelMember } = useChannelStore();
  const { servers } = useServerStore();
  
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<ChannelMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const channelMembers = await listChannelMembers(channelId);
      const membersWithRoles: ChannelMember[] = channelMembers.map(m => ({
        ...m,
        username: `User ${m.userId.slice(-4)}`,
        avatarUrl: null,
        role: 'member' as const,
      }));
      setMembers(membersWithRoles);
    } catch (error) {
      toast.error('Failed to load members', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [channelId, listChannelMembers]);

  const loadAvailableUsers = useCallback(async () => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;
    
    setAvailableUsers([
      { 
        channelId, 
        userId: 'user-1', 
        addedAt: '', 
        username: 'Alice', 
        avatarUrl: null, 
        role: 'owner' as const
      },
      { 
        channelId, 
        userId: 'user-2', 
        addedAt: '', 
        username: 'Bob', 
        avatarUrl: null, 
        role: 'moderator' as const
      },
      { 
        channelId, 
        userId: 'user-3', 
        addedAt: '', 
        username: 'Charlie', 
        avatarUrl: null, 
        role: 'member' as const
      },
      { 
        channelId, 
        userId: 'user-4', 
        addedAt: '', 
        username: 'Diana', 
        avatarUrl: null, 
        role: 'member' as const
      },
      { 
        channelId, 
        userId: 'user-5', 
        addedAt: '', 
        username: 'Eve', 
        avatarUrl: null, 
        role: 'member' as const
      },
    ].filter(u => !members.some(m => m.userId === u.userId)));
  }, [serverId, servers, members, channelId]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadMembers();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAvailableUsers();
    }
  }, [open, channelId, serverId, loadMembers, loadAvailableUsers]);

  const filteredAvailableUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddMember = async (userId: string) => {
    setAdding(userId);
    try {
      await addChannelMember(channelId, userId);
      toast.success('Member added');
      loadMembers();
      loadAvailableUsers();
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
      loadMembers();
      loadAvailableUsers();
    } catch (error) {
      toast.error('Failed to remove member', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setRemoving(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" onClick={() => onOpenChange(false)} aria-hidden="true">
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-bg-raised shadow-xl animate-in slide-in-from-right" onClick={e => e.stopPropagation()}>
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h2 className="text-text-primary font-semibold">Manage Members</h2>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {/* Current Members */}
          <div className="mb-6">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">
              Current Members ({members.length})
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-4">No members yet</p>
            ) : (
              <div className="space-y-2">
                {members.map(member => (
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
      </div>
    </div>
  );
}