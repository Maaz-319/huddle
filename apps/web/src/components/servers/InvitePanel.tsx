import { useState, useEffect, useCallback } from 'react';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/toastStore';
import { useServerStore } from '@/stores/serverStore';

interface InvitePanelProps {
  serverId: string;
  /** Hide regenerate/revoke for members without invite management rights. */
  canManage?: boolean;
  onChanged?: () => void;
}

/**
 * The invite link + its actions. Shared by the quick InviteDialog (server
 * context menu) and the ServerSettings Invites section.
 */
export function InvitePanel({ serverId, canManage = true, onChanged }: InvitePanelProps) {
  const { getInvite, revokeInvite, regenerateInvite } = useServerStore();
  const [inviteCode, setInviteCode] = useState<string>('');
  const [revokedAt, setRevokedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadInvite = useCallback(async () => {
    setLoading(true);
    try {
      const invite = await getInvite(serverId);
      setInviteCode(invite.code);
      setRevokedAt(invite.revokedAt);
    } catch (error) {
      toast.error('Failed to load invite', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [serverId, getInvite]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInvite();
  }, [loadInvite]);

  const inviteUrl = `${window.location.origin}/invite/${inviteCode}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success('Invite link copied to clipboard');
  };

  const handleRevoke = async () => {
    if (!confirm('Are you sure you want to revoke this invite? The link will become invalid.')) return;

    setActionLoading('revoke');
    try {
      await revokeInvite(serverId);
      toast.success('Invite revoked');
      loadInvite();
      onChanged?.();
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
      onChanged?.();
    } catch (error) {
      toast.error('Failed to regenerate invite', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
      </div>
    );
  }

  if (!inviteCode) {
    return <p className="text-text-muted text-sm">You don't have access to this server's invite.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Invite link
        </label>
        <div className="relative">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className={cn(
              'w-full px-3 pr-10 py-2 bg-bg-base border border-border-subtle rounded-lg',
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

      {canManage && (
        <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}
