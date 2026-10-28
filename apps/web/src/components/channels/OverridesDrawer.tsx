import { Fragment, useState, useEffect, useCallback } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
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

const CAPABILITY_SHORT_LABELS: Record<Capability, string> = {
  view: 'View',
  post: 'Post',
  delete_others: 'Delete',
  manage_settings: 'Manage',
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

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <RadixDialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-bg-raised border-l border-border-subtle shadow-xl flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <div className="flex h-16 shrink-0 items-center justify-between px-4 border-b border-border-subtle">
            <div className="flex items-center gap-3 min-w-0">
              <RadixDialog.Title className="text-text-primary font-semibold truncate">
                Channel Overrides
              </RadixDialog.Title>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-text-muted hover:text-text-primary" aria-label="About overrides">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-xs">
                  <p className="text-sm text-text-primary">
                    Overrides can only tighten permissions (revoke capabilities).
                    Unchecking a box restores the server-wide default for that role.
                    Owner permissions cannot be overridden.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </RadixDialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* One grid for header + rows so columns always line up.
                    Outer scroll guards very narrow viewports from clipping
                    the checkbox columns. */}
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-[8rem_repeat(4,minmax(2.5rem,1fr))] gap-2 items-center min-w-[22rem]">
                  <div className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    Role
                  </div>
                  {CAPABILITIES.map(cap => (
                    <div key={cap} className="text-xs font-medium text-text-muted uppercase tracking-wider text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">{CAPABILITY_SHORT_LABELS[cap]}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-sm text-text-primary">{CAPABILITY_LABELS[cap]} — {CAPABILITY_DESCRIPTIONS[cap]}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ))}

                  {ROLES.map(role => (
                    <Fragment key={role}>
                      <div className="min-w-0">
                        <span className={cn(
                          'inline-block max-w-full truncate px-2 py-1 rounded text-xs font-medium',
                          role === 'owner' && 'bg-accent-owner/10 text-accent-owner',
                          role === 'moderator' && 'bg-accent-info/10 text-accent-info',
                          role === 'member' && 'bg-bg-raised text-text-muted'
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
                              disabled={role === 'owner' || saving === `${role}:${cap}`}
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
                    </Fragment>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="mt-6 p-3 bg-bg-base border border-border-subtle rounded-lg text-xs text-text-muted space-y-1">
              <p className="font-medium text-text-secondary">Legend:</p>
              <p>☑ Checked = Capability granted (inherits server default)</p>
              <p>☐ Unchecked = Capability revoked (tightened)</p>
              <p className="text-amber-400">Owner row is disabled — owners cannot be overridden</p>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
