import { useState, useEffect, useCallback } from 'react';
import { X, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/components/ui/cn';
import { toast } from '@/stores/toastStore';
import { useChannelStore } from '@/stores/channelStore';
import { 
  Tooltip, 
  TooltipTrigger, 
  TooltipContent 
} from '@/components/ui/tooltip';

type Capability = 'view' | 'post' | 'delete_others' | 'manage_settings';
type Role = 'owner' | 'moderator' | 'member';

const CAPABILITIES: Capability[] = ['view', 'post', 'delete_others', 'manage_settings'];
const ROLES: Role[] = ['owner', 'moderator', 'member'];

const CAPABILITY_LABELS: Record<Capability, string> = {
  view: 'View Channel',
  post: 'Post Messages',
  delete_others: 'Delete Others\' Messages',
  manage_settings: 'Manage Settings',
};

const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  view: 'Can see and read messages in this channel',
  post: 'Can send messages in this channel',
  delete_others: 'Can delete messages from other users',
  manage_settings: 'Can edit channel name, privacy, and overrides',
};

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  moderator: 'Moderator',
  member: 'Member',
};

interface OverridesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

export function OverridesDrawer({ open, onOpenChange, channelId }: OverridesDrawerProps) {
  const { listOverrides, revokeCapability, restoreCapability } = useChannelStore();
  
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const loadOverrides = useCallback(async () => {
    setLoading(true);
    try {
      const overrideList = await listOverrides(channelId);
      const overrideMap: Record<string, Record<string, boolean>> = {};
      ROLES.forEach(role => {
        overrideMap[role] = {};
        CAPABILITIES.forEach(cap => {
          overrideMap[role][cap] = overrideList.some(o => o.role === role && o.capability === cap);
        });
      });
      // Owner is never overridable
      CAPABILITIES.forEach(cap => {
        overrideMap.owner[cap] = false;
      });
      setOverrides(overrideMap);
    } catch (error) {
      toast.error('Failed to load overrides', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [channelId, listOverrides]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadOverrides();
    }
  }, [open, channelId, loadOverrides]);

  const handleToggle = async (role: Role, capability: Capability) => {
    if (role === 'owner') return; // Owner is never overridable
    
    const key = `${role}:${capability}`;
    setSaving(key);
    
    const currentlyRevoked = overrides[role]?.[capability] ?? false;
    const newState = !currentlyRevoked;
    
    // Optimistic update
    setOverrides(prev => ({
      ...prev,
      [role]: { ...prev[role], [capability]: newState }
    }));

    try {
      if (newState) {
        await revokeCapability(channelId, role, capability);
        toast.success(`Revoked ${CAPABILITY_LABELS[capability]} from ${ROLE_LABELS[role]}`);
      } else {
        await restoreCapability(channelId, role, capability);
        toast.success(`Restored ${CAPABILITY_LABELS[capability]} to ${ROLE_LABELS[role]}`);
      }
    } catch (error) {
      // Revert on error
      setOverrides(prev => ({
        ...prev,
        [role]: { ...prev[role], [capability]: currentlyRevoked }
      }));
      toast.error('Failed to update override', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSaving(null);
    }
  };

  const isRevoked = (role: Role, capability: Capability) => {
    return overrides[role]?.[capability] ?? false;
  };

  const isDisabled = (role: Role) => {
    return role === 'owner';
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" onClick={() => onOpenChange(false)} aria-hidden="true">
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-raised shadow-xl animate-in slide-in-from-right" onClick={e => e.stopPropagation()}>
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <h2 className="text-text-primary font-semibold">Channel Overrides</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="text-text-muted hover:text-text-primary">
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" align="center" className="max-w-xs">
                <p className="text-sm text-text-primary">
                  Overrides can only tighten permissions (revoke capabilities). 
                  Unchecking a box restores the server-wide default for that role.
                  Owner permissions cannot be overridden.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header row */}
              <div className="grid grid-cols-5 gap-2 px-2 text-xs font-medium text-text-muted uppercase tracking-wider">
                <div className="w-32">Role</div>
                {CAPABILITIES.map(cap => (
                  <div key={cap} className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{CAPABILITY_LABELS[cap]}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-sm text-text-primary">{CAPABILITY_DESCRIPTIONS[cap]}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>

              {ROLES.map(role => (
                <div key={role} className="grid grid-cols-5 gap-2 items-center px-2">
                  <div className="w-32">
                    <span className={cn(
                      'inline-block px-2 py-1 rounded text-xs font-medium',
                      role === 'owner' && 'bg-purple-500/20 text-purple-400',
                      role === 'moderator' && 'bg-blue-500/20 text-blue-400',
                      role === 'member' && 'bg-gray-500/20 text-gray-400'
                    )}>
                      {ROLE_LABELS[role]}
                    </span>
                  </div>
                  {CAPABILITIES.map(cap => (
                    <div key={cap} className="flex items-center justify-center">
                      <div className="relative">
                        <Checkbox
                          id={`${role}-${cap}`}
                          checked={!isRevoked(role, cap)} // checked = NOT revoked (enabled)
                          onCheckedChange={() => handleToggle(role, cap)}
                          disabled={isDisabled(role) || saving === `${role}:${cap}`}
                          className="h-4 w-4"
                        />
                        {saving === `${role}:${cap}` && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Legend */}
          <div className="mt-6 p-3 bg-bg-base border border-border-subtle rounded-lg text-xs text-text-muted space-y-1">
            <p className="font-medium text-text-secondary">Legend:</p>
            <p>☑ Checked = Capability granted (inherits server default)</p>
            <p>☐ Unchecked = Capability revoked (tightened)</p>
            <p className="text-amber-400">Owner row is disabled - owners cannot be overridden</p>
          </div>
        </div>
      </div>
    </div>
  );
}