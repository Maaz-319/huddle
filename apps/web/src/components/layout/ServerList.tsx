import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Settings, Trash2, ExternalLink } from 'lucide-react';
import { useServerStore } from '@/stores/serverStore';
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
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/toastStore';
import { InviteDialog } from '@/components/servers/InviteDialog';

interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: 'owner' | 'moderator' | 'member';
  memberInviteToggle: boolean;
  createdAt: string;
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

export function ServerList() {
  const { servers, currentServerId, createServer, deleteServer } = useServerStore();
  const { closeAllDrawers } = useUIStore();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIconUrl, setCreateIconUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [contextMenuServer, setContextMenuServer] = useState<Server | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteDialogServerId, setInviteDialogServerId] = useState<string | null>(null);

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    
    setCreating(true);
    try {
      const newServer = await createServer(createName.trim(), createIconUrl.trim() || null);
      setShowCreateDialog(false);
      setCreateName('');
      setCreateIconUrl('');
      navigate({ to: `/app/${newServer.id}` });
    } catch (error) {
      toast.error('Failed to create server', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this server? This action cannot be undone.')) return;
    
    try {
      await deleteServer(serverId);
      navigate({ to: '/app' });
    } catch (error) {
      toast.error('Failed to delete server', error instanceof Error ? error.message : 'Unknown error');
    }
    setContextMenuServer(null);
  };

  const handleInviteClick = (serverId: string) => {
    setInviteDialogServerId(serverId);
    setShowInviteDialog(true);
    setContextMenuServer(null);
  };

  const handleSettingsClick = (serverId: string) => {
    navigate({ to: `/app/${serverId}/settings` });
    setContextMenuServer(null);
  };

  if (servers.length === 0) {
    return (
      <div className="flex flex-col h-full w-16 bg-bg-raised border-r border-border-subtle">
        <div className="flex h-16 items-center justify-center border-b border-border-subtle">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowCreateDialog(true)}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Create server"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-text-muted text-sm">No servers yet</p>
            <Button 
              variant="primary" 
              size="sm" 
              className="mt-2"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Server
            </Button>
          </div>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogTitle>Create Server</DialogTitle>
            <DialogDescription>Give your server a name and optional icon</DialogDescription>
            <form onSubmit={handleCreateServer}>
              <div className="space-y-4 py-4">
                <div>
                  <label htmlFor="server-name" className="block text-sm font-medium text-text-secondary mb-1">
                    Server Name
                  </label>
                  <Input
                    id="server-name"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="My Server"
                    maxLength={100}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="server-icon" className="block text-sm font-medium text-text-secondary mb-1">
                    Icon URL (optional)
                  </label>
                  <Input
                    id="server-icon"
                    value={createIconUrl}
                    onChange={(e) => setCreateIconUrl(e.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating || !createName.trim()}>
                  {creating ? 'Creating...' : 'Create Server'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col h-full bg-bg-raised border-r border-border-subtle transition-all duration-200',
      'w-16',
      'lg:w-16'
    )}>
      <div className="flex h-16 items-center justify-center border-b border-border-subtle relative">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setShowCreateDialog(true)}
          className="text-text-secondary hover:text-text-primary absolute left-2"
          aria-label="Create server"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
      
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Servers">
        {servers.map((server) => (
          <Tooltip key={server.id}>
            <TooltipTrigger>
              <a
                href={`/app/${server.id}`}
                className={cn(
                  'relative flex h-12 w-12 items-center justify-center rounded-lg',
                  'transition-colors',
                  'hover:bg-bg-overlay',
                  currentServerId === server.id 
                    ? 'bg-accent-primary/20 text-accent-primary' 
                    : 'text-text-secondary hover:text-text-primary'
                )}
                onClick={() => closeAllDrawers()}
              >
                {server.iconUrl ? (
                  <img 
                    src={server.iconUrl} 
                    alt="" 
                    className="h-8 w-8 rounded-lg object-cover" 
                  />
                ) : (
                  <div 
                    className="h-8 w-8 rounded-lg flex items-center justify-center font-medium text-white text-lg"
                    style={{ backgroundColor: getColorFromString(server.name) }}
                  >
                    {getInitials(server.name)}
                  </div>
                )}
                <TooltipContent side="right" align="center">
                  <div className="px-2 py-1 bg-bg-overlay text-text-primary text-sm rounded shadow-lg whitespace-nowrap">
                    {server.name}
                  </div>
                </TooltipContent>
              </a>
            </TooltipTrigger>
          </Tooltip>
        ))}
      </nav>

      <div className="p-2 border-t border-border-subtle">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setShowCreateDialog(true)}
          className="w-full text-text-secondary hover:text-text-primary"
          aria-label="Create server"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogTitle>Create Server</DialogTitle>
          <DialogDescription>Give your server a name and optional icon</DialogDescription>
          <form onSubmit={handleCreateServer}>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="server-name" className="block text-sm font-medium text-text-secondary mb-1">
                  Server Name
                </label>
                <Input
                  id="server-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Server"
                  maxLength={100}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="server-icon" className="block text-sm font-medium text-text-secondary mb-1">
                  Icon URL (optional)
                </label>
                <Input
                  id="server-icon"
                  value={createIconUrl}
                  onChange={(e) => setCreateIconUrl(e.target.value)}
                  placeholder="https://example.com/icon.png"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !createName.trim()}>
                {creating ? 'Creating...' : 'Create Server'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InviteDialog 
        open={showInviteDialog} 
        onOpenChange={setShowInviteDialog} 
        serverId={inviteDialogServerId ?? ''} 
      />

      {contextMenuServer && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="fixed inset-0 z-50" onClick={() => setContextMenuServer(null)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="fixed z-50"
            sideOffset={5}
          >
            <DropdownMenuLabel className="text-text-primary">{contextMenuServer.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleInviteClick(contextMenuServer.id)}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Invite People
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSettingsClick(contextMenuServer.id)}>
              <Settings className="h-4 w-4 mr-2" />
              Server Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => handleDeleteServer(contextMenuServer.id)}
              className="text-accent-warn focus:text-accent-warn"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Server
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}