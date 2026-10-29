import { useParams, Link } from '@tanstack/react-router';
import { Hash, Lock, Plus, Settings, Users, Trash2, Edit2, MoreVertical } from 'lucide-react';
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
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useServerStore } from '@/stores/serverStore';
import type { ChannelResponse } from '@/types/channel';

type Channel = ChannelResponse;

export function ChannelList() {
  const params = useParams({ strict: false }) as { serverId?: string };
  const serverId = params.serverId;
  const servers = useServerStore((state) => state.servers);
  const { channelsByServer, currentChannelId, createChannel, deleteChannel, updateChannel } = useChannelStore();
  const permissions = useMyPermissions(serverId ?? null);
  const { closeAllDrawers } = useUIStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIsPrivate, setCreateIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const channelMenu = useContextMenu<Channel>();
  // The channel any open dialog/drawer acts on — kept separately from the
  // menu state so closing the menu doesn't orphan the drawer's target.
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showMemberDrawer, setShowMemberDrawer] = useState(false);
  const [showOverridesDrawer, setShowOverridesDrawer] = useState(false);

  const channels = serverId ? channelsByServer.get(serverId) ?? [] : [];
  const server = servers.find((candidate) => candidate.id === serverId);
  const canCreateChannel = Boolean(permissions.confirmed && server && (
    server.channelCreationPolicy === 'everyone' ||
    (server.channelCreationPolicy === 'mods_only' && permissions.hasRole('owner', 'moderator')) ||
    (server.channelCreationPolicy === 'owner_only' && permissions.hasRole('owner'))
  ));
  const canCreatePrivate = permissions.hasRole('owner', 'moderator');

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !serverId || !canCreateChannel) return;
    
    setCreating(true);
    try {
      await createChannel(serverId, { name: createName.trim(), isPrivate: createIsPrivate && canCreatePrivate });
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
    if (!editName.trim() || !activeChannel || !permissions.canInChannel(activeChannel.id, 'manage_settings')) return;
    
    setEditing(true);
    try {
      await updateChannel(activeChannel.id, { name: editName.trim(), isPrivate: editIsPrivate });
      setShowEditDialog(false);
      setActiveChannel(null);
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
  };

  const openEditDialog = (channel: Channel) => {
    setActiveChannel(channel);
    setEditName(channel.name);
    setEditIsPrivate(channel.isPrivate);
    setShowEditDialog(true);
  };

  const openMemberManagement = (channel: Channel) => {
    setActiveChannel(channel);
    setShowMemberDrawer(true);
  };

  const openOverrides = (channel: Channel) => {
    setActiveChannel(channel);
    setShowOverridesDrawer(true);
  };

  if (!serverId) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-base border-r border-border-subtle">
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
      'w-full'
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Channels</h2>
        {canCreateChannel && <Button
          variant="ghost" 
          size="icon" 
          onClick={() => setShowCreateDialog(true)}
          className="text-text-secondary hover:text-text-primary"
          aria-label="Create channel"
        >
          <Plus className="h-4 w-4" />
        </Button>}
      </div>
      
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Channels">
        {channels.length === 0 ? (
          <div className="px-4 py-4 text-center">
            <p className="text-text-muted text-sm">No channels yet</p>
            {canCreateChannel && <Button
              variant="primary" 
              size="sm" 
              className="mt-2 w-full"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Channel
            </Button>}
          </div>
        ) : (
          channels.map((channel) => (
            <div key={channel.id} className="group relative">
              <Tooltip>
                <TooltipTrigger asChild>
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
                    {...(permissions.canInChannel(channel.id, 'manage_settings') ? channelMenu.triggerProps(channel) : {})}
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
                  {channel.name} {channel.isPrivate ? '(Private)' : '(Public)'}
                </TooltipContent>
              </Tooltip>

              {/* Visible affordance — kebab opens the same menu as right-click */}
              {permissions.canInChannel(channel.id, 'manage_settings') && <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                  'pointer-coarse:opacity-100',
                  'text-text-secondary hover:text-text-primary'
                )}
                aria-label={`Options for ${channel.name}`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  channelMenu.open(channel, rect.right, rect.bottom + 4);
                }}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>}
            </div>
          ))
        )}
      </nav>

      <div className="p-2 border-t border-border-subtle">
        {canCreateChannel && <Button
          variant="ghost" 
          size="sm" 
          className="w-full text-text-secondary hover:text-text-primary"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Channel
        </Button>}
      </div>

      <Dialog open={showCreateDialog && canCreateChannel} onOpenChange={setShowCreateDialog}>
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
              {canCreatePrivate && <div className="flex items-center gap-2">
                <Checkbox
                  id="channel-private"
                  checked={createIsPrivate}
                  onCheckedChange={setCreateIsPrivate}
                />
                <Label htmlFor="channel-private" className="text-sm text-text-primary cursor-pointer">
                  Private Channel
                </Label>
              </div>}
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

      <Dialog open={showEditDialog && Boolean(activeChannel && permissions.canInChannel(activeChannel.id, 'manage_settings'))} onOpenChange={(open) => { setShowEditDialog(open); if (!open) setActiveChannel(null); }}>
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

      <DropdownMenu
        open={channelMenu.state !== null}
        onOpenChange={(open) => { if (!open) channelMenu.close(); }}
      >
        {channelMenu.state && permissions.canInChannel(channelMenu.state.target.id, 'manage_settings') && (
          <>
            {/* Radix 2.x has no virtual anchor; a 1px fixed trigger at the
                pointer gives the menu its position. */}
            <DropdownMenuTrigger
              style={{
                position: 'fixed',
                left: channelMenu.state.anchor.x,
                top: channelMenu.state.anchor.y,
                width: 1,
                height: 1,
                padding: 0,
                border: 0,
              }}
              aria-hidden
            />
            <DropdownMenuContent sideOffset={5} className="z-[60]">
              <DropdownMenuLabel className="text-text-primary truncate">
                {channelMenu.state.target.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openEditDialog(channelMenu.state!.target)}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Channel
              </DropdownMenuItem>
              {channelMenu.state.target.isPrivate && (
                <DropdownMenuItem onClick={() => openMemberManagement(channelMenu.state!.target)}>
                  <Users className="h-4 w-4 mr-2" />
                  Manage Members
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => openOverrides(channelMenu.state!.target)}>
                <Settings className="h-4 w-4 mr-2" />
                Overrides
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteChannel(channelMenu.state!.target.id)}
                className="text-accent-warn focus:text-accent-warn"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Channel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </>
        )}
      </DropdownMenu>

      <MemberManagementDrawer
        open={showMemberDrawer}
        onOpenChange={(open) => { setShowMemberDrawer(open); if (!open) setActiveChannel(null); }}
        channelId={activeChannel?.id ?? ''}
        serverId={serverId ?? ''}
      />

      <OverridesDrawer
        open={showOverridesDrawer}
        onOpenChange={(open) => { setShowOverridesDrawer(open); if (!open) setActiveChannel(null); }}
        channelId={activeChannel?.id ?? ''}
        serverId={serverId ?? ''}
      />
    </div>
  );
}
