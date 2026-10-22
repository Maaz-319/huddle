import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { Plus, Settings, Trash2, ExternalLink, MoreVertical } from 'lucide-react';
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
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMyRole } from '@/hooks/useMyRole';
import { getInitials, getColorFromString } from '@/utils/avatar';

interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: 'owner_only' | 'everyone' | 'mods_only';
  memberInviteToggle: boolean;
  createdAt: string;
}

export function ServerList() {
  const { servers, currentServerId, createServer, deleteServer } = useServerStore();
  const { closeAllDrawers } = useUIStore();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIconUrl, setCreateIconUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const serverMenu = useContextMenu<Server>();
  const menuServerRole = useMyRole(serverMenu.state?.target.id ?? null);
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
  };

  const handleInviteClick = (serverId: string) => {
    setInviteDialogServerId(serverId);
    setShowInviteDialog(true);
  };

  const handleSettingsClick = (serverId: string) => {
    navigate({ to: `/app/${serverId}/settings` });
  };

  const createServerDialog = (
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
  );

  if (servers.length === 0) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-raised border-r border-border-subtle">
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
        {createServerDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-bg-raised border-r border-border-subtle">
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

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Servers">
        {servers.map((server) => {
          const isActive = currentServerId === server.id;
          return (
            <div key={server.id} className="group relative">
              {/* Active-server pill — the Discord-style left bar */}
              <span
                className={cn(
                  'absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-accent-primary transition-all duration-150',
                  isActive ? 'h-5 opacity-100' : 'h-0 opacity-0'
                )}
                aria-hidden="true"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/app/$serverId"
                    params={{ serverId: server.id }}
                    className={cn(
                      'relative flex h-12 w-12 items-center justify-center rounded-lg ml-2',
                      'transition-colors',
                      'hover:bg-bg-overlay',
                      isActive
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                    onClick={() => closeAllDrawers()}
                    {...serverMenu.triggerProps(server)}
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
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" align="center">
                  {server.name}
                </TooltipContent>
              </Tooltip>

              {/* Visible affordance — kebab opens the same menu as right-click.
                  Sits outside the link so it never hijacks navigation. */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'absolute -right-1 top-0 h-5 w-5 p-0 bg-bg-raised rounded',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                  'pointer-coarse:opacity-100',
                  'text-text-secondary hover:text-text-primary'
                )}
                aria-label={`Options for ${server.name}`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  serverMenu.open(server, rect.right, rect.bottom + 4);
                }}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
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

      {createServerDialog}

      <InviteDialog
        open={showInviteDialog}
        onOpenChange={setShowInviteDialog}
        serverId={inviteDialogServerId ?? ''}
      />

      <DropdownMenu
        open={serverMenu.state !== null}
        onOpenChange={(open) => { if (!open) serverMenu.close(); }}
      >
        {serverMenu.state && (
          <>
            {/* Radix 2.x has no virtual anchor; a 1px fixed trigger at the
                pointer gives the menu its position. */}
            <DropdownMenuTrigger
              style={{
                position: 'fixed',
                left: serverMenu.state.anchor.x,
                top: serverMenu.state.anchor.y,
                width: 1,
                height: 1,
                padding: 0,
                border: 0,
              }}
              aria-hidden
            />
            <DropdownMenuContent sideOffset={5} className="z-[60]">
              <DropdownMenuLabel className="text-text-primary truncate">
                {serverMenu.state.target.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleInviteClick(serverMenu.state!.target.id)}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Invite People
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSettingsClick(serverMenu.state!.target.id)}>
                <Settings className="h-4 w-4 mr-2" />
                Server Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {menuServerRole === 'owner' && (
                <DropdownMenuItem
                  onClick={() => handleDeleteServer(serverMenu.state!.target.id)}
                  className="text-accent-warn focus:text-accent-warn"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Server
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </>
        )}
      </DropdownMenu>
    </div>
  );
}
