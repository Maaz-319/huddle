import { useState, useEffect, useCallback } from 'react';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  DialogRoot as Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions as DialogFooter
} from '@/components/ui/dialog';
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/toastStore';
import { useServerStore } from '@/stores/serverStore';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
}

export function InviteDialog({ open, onOpenChange, serverId }: InviteDialogProps) {
  const { getInvite, revokeInvite, regenerateInvite } = useServerStore();
  const [inviteCode, setInviteCode] = useState<string>('');
  const [revokedAt, setRevokedAt] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadInvite = useCallback(async () => {
    try {
      const invite = await getInvite(serverId);
      setInviteCode(invite.code);
      setRevokedAt(invite.revokedAt);
    } catch (error) {
      toast.error('Failed to load invite', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [serverId, getInvite]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadInvite();
    }
  }, [open, serverId, loadInvite]);

  const handleCopy = async () => {
    const url = `${import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:5173'}/invite/${inviteCode}`;
    await navigator.clipboard.writeText(url);
    toast.success('Invite link copied to clipboard');
  };

  const handleRevoke = async () => {
    if (!confirm('Are you sure you want to revoke this invite? The link will become invalid.')) return;
    
    setActionLoading('revoke');
    try {
      await revokeInvite(serverId);
      toast.success('Invite revoked');
      loadInvite();
    } catch (error) {
      toast.error('Failed to revoke invite', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('Are you sure you want to regenerate the invite code? The old code will become invalid.')) return;
    
    setActionLoading('regenerate');
    try {
      await regenerateInvite(serverId);
      toast.success('Invite regenerated');
      loadInvite();
    } catch (error) {
      toast.error('Failed to regenerate invite', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Invite People</DialogTitle>
        <DialogDescription>Share this link to invite others to your server</DialogDescription>
        
        <div className="space-y-4 py-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Invite Link
            </label>
            <div className="relative">
              <input
                type="text"
                readOnly
                value={`${import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:5173'}/invite/${inviteCode}`}
                className={cn(
                  'w-full px-3 py-2 bg-bg-base border border-border-subtle rounded-lg',
                  'text-text-primary placeholder-text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-accent-primary'
                )}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={handleCopy}
                aria-label="Copy invite link"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {revokedAt && (
            <div className="p-3 bg-amber-950/50 border border-amber-500/20 rounded-lg">
              <p className="text-sm text-amber-400">
                This invite was revoked on {new Date(revokedAt).toLocaleDateString()}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={actionLoading === 'regenerate' || !!revokedAt}
              className="text-text-secondary hover:text-text-primary"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Regenerate
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRevoke}
              disabled={actionLoading === 'revoke' || !!revokedAt}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Revoke
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}