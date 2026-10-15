import { useParams, Link } from '@tanstack/react-router';
import { Hash, Lock, Plus, Settings, Users, Trash2, Edit2 } from 'lucide-react';
import { useChannelStore } from '@/stores/channelStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenuRoot as DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel 
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { DialogRoot as Dialog, DialogContent, DialogTitle, DialogDescription, DialogActions as DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/toastStore';
import { useState } from 'react';
import { MemberManagementDrawer } from '@/components/channels/MemberManagementDrawer';
import { OverridesDrawer } from '@/components/channels/OverridesDrawer';

interface Channel {
  id: string;
  serverId: string;
  name: string;
  isPrivate: boolean;
  createdAt: string;
}

export function ChannelList() {
  const params = useParams({ strict: false }) as { serverId?: string };
  const serverId = params.serverId;
  const { channelsByServer, currentChannelId, createChannel, deleteChannel, updateChannel } = useChannelStore();
  const { closeAllDrawers } = useUIStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIsPrivate, setCreateIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [contextMenuChannel, setContextMenuChannel] = useState<Channel | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showMemberDrawer, setShowMemberDrawer] = useState(false);
  const [showOverridesDrawer, setShowOverridesDrawer] = useState(false);

  const channels = serverId ? channelsByServer.get(serverId) ?? [] : [];

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !serverId) return;
    
    setCreating(true);
    try {
      await createChannel(serverId, { name: createName.trim(), isPrivate: createIsPrivate });
      setShowCreateDialog(false);
      setCreateName('');
      setCreateIsPrivate(false);
    } catch (error) {
      toast.error('Failed to create channel', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleEditChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !contextMenuChannel) return;
    
    setEditing(true);
    try {
      await updateChannel(contextMenuChannel.id, { name: editName.trim(), isPrivate: editIsPrivate });
      setShowEditDialog(false);
      setContextMenuChannel(null);
    } catch (error) {
      toast.error('Failed to update channel', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setEditing(false);
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm('Are you sure you want to delete this channel? This action cannot be undone.')) return;
    
    try {
      await deleteChannel(channelId);
    } catch (error) {
      toast.error('Failed to delete channel', error instanceof Error ? error.message : 'Unknown error');
    }
    setContextMenuChannel(null);
  };

  const openEditDialog = (channel: Channel) => {
    setContextMenuChannel(channel);
    setEditName(channel.name);
    setEditIsPrivate(channel.isPrivate);
    setShowEditDialog(true);
  };

  const openMemberManagement = () => {
    setContextMenuChannel(null);
    setShowMemberDrawer(true);
  };

  const openOverrides = () => {
    setContextMenuChannel(null);
    setShowOverridesDrawer(true);
  };

  if (!serverId) {
    return (
      <div className="flex flex-col h-full w-64 bg-bg-base border-r border-border-subtle">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Channels</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-sm">Select a server</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col h-full bg-bg-base border-r border-border-subtle transition-all duration-200',
      'w-64',
      'lg:w-64'
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Channels</h2>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setShowCreateDialog(true)}
          className="text-text-secondary hover:text-text-primary"
          aria-label="Create channel"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Channels">
        {channels.length === 0 ? (
          <div className="px-4 py-4 text-center">
            <p className="text-text-muted text-sm">No channels yet</p>
            <Button 
              variant="primary" 
              size="sm" 
              className="mt-2 w-full"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Channel
            </Button>
          </div>
        ) : (
          channels.map((channel) => (
            <Tooltip key={channel.id}>
              <TooltipTrigger>
                <Link
                  to="/app/$serverId/$channelId"
                  params={{ serverId, channelId: channel.id }}
                  className={cn(
                    'relative flex h-10 items-center gap-3 px-3 rounded-lg',
                    'transition-colors',
                    'hover:bg-bg-raised',
                    currentChannelId === channel.id 
                      ? 'bg-accent-primary/10 text-accent-primary' 
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                  onClick={() => closeAllDrawers()}
                >
                  {channel.isPrivate ? (
                    <Lock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  ) : (
                    <Hash className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate font-medium text-sm">{channel.name}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                <div className="px-2 py-1 bg-bg-overlay text-text-primary text-sm rounded shadow-lg whitespace-nowrap">
                  {channel.name} {channel.isPrivate ? '(Private)' : '(Public)'}
                </div>
              </TooltipContent>
            </Tooltip>
          ))
        )}
      </nav>

      <div className="p-2 border-t border-border-subtle">
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full text-text-secondary hover:text-text-primary"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Channel
        </Button>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogTitle>Create Channel</DialogTitle>
          <DialogDescription>Give your channel a name and choose type</DialogDescription>
          <form onSubmit={handleCreateChannel}>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="channel-name" className="block text-sm font-medium text-text-secondary mb-1">
                  Channel Name
                </label>
                <Input
                  id="channel-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="general"
                  maxLength={100}
                  required
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="channel-private"
                  checked={createIsPrivate}
                  onCheckedChange={setCreateIsPrivate}
                />
                <Label htmlFor="channel-private" className="text-sm text-text-primary cursor-pointer">
                  Private Channel
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !createName.trim()}>
                {creating ? 'Creating...' : 'Create Channel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogTitle>Edit Channel</DialogTitle>
          <DialogDescription>Update channel name and type</DialogDescription>
          <form onSubmit={handleEditChannel}>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="edit-channel-name" className="block text-sm font-medium text-text-secondary mb-1">
                  Channel Name
                </label>
                <Input
                  id="edit-channel-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="general"
                  maxLength={100}
                  required
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-channel-private"
                  checked={editIsPrivate}
                  onCheckedChange={setEditIsPrivate}
                />
                <Label htmlFor="edit-channel-private" className="text-sm text-text-primary cursor-pointer">
                  Private Channel
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowEditDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editing || !editName.trim()}>
                {editing ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {contextMenuChannel && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="fixed inset-0 z-50" onClick={() => setContextMenuChannel(null)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="fixed z-50"
            sideOffset={5}
          >
            <DropdownMenuLabel className="text-text-primary">{contextMenuChannel.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openEditDialog(contextMenuChannel)}>
              <Edit2 className="h-4 w-4 mr-2" />
              Edit Channel
            </DropdownMenuItem>
            {contextMenuChannel.isPrivate && (
              <DropdownMenuItem onClick={openMemberManagement}>
                <Users className="h-4 w-4 mr-2" />
                Manage Members
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={openOverrides}>
              <Settings className="h-4 w-4 mr-2" />
              Overrides
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => handleDeleteChannel(contextMenuChannel.id)}
              className="text-accent-warn focus:text-accent-warn"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Channel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <MemberManagementDrawer
        open={showMemberDrawer}
        onOpenChange={setShowMemberDrawer}
        channelId={contextMenuChannel?.id ?? ''}
        serverId={serverId ?? ''}
      />

      <OverridesDrawer
        open={showOverridesDrawer}
        onOpenChange={setShowOverridesDrawer}
        channelId={contextMenuChannel?.id ?? ''}
      />
    </div>
  );
}