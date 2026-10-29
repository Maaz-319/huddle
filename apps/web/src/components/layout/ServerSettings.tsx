import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from '@tanstack/react-router';
import {
  ArrowLeft, Trash2, ShieldCheck, Users, Link2, Lock, Settings2, UserCog,
} from 'lucide-react';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { toast } from '@/stores/toastStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroupRoot, RadioGroupItem } from '@/components/ui/radio-group';
import {
  DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { InvitePanel } from '@/components/servers/InvitePanel';
import { cn } from '@/components/ui/cn';
import type { ServerResponse } from '@/types/server';
import type { ServerMemberResponse } from '@/types/channel';
import type { MeResponse } from '@/types/user';

type Section = 'overview' | 'members' | 'invites' | 'privacy' | 'danger';

type MemberRow = ServerMemberResponse & {
  username: string;
  avatarUrl: string | null;
};

const POLICY_OPTIONS: Array<{ value: ServerResponse['channelCreationPolicy']; label: string; description: string }> = [
  { value: 'owner_only', label: 'Only you', description: 'Just the server owner can create channels' },
  { value: 'mods_only', label: 'Moderators and you', description: 'Owners and moderators can create channels' },
  { value: 'everyone', label: 'Everyone', description: 'Any member can create channels' },
];

function getColorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function ServerSettings() {
  const params = useParams({ strict: false }) as { serverId?: string };
  const serverId = params.serverId ?? '';
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { servers, fetchServers, updateServer, deleteServer, updateMemberRole, transferOwnership } = useServerStore();
  const { listServerMembers } = useChannelStore();

  const [section, setSection] = useState<Section>('overview');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [name, setName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [savingOverview, setSavingOverview] = useState(false);

  const [policy, setPolicy] = useState<ServerResponse['channelCreationPolicy']>('everyone');
  const [inviteToggle, setInviteToggle] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferConfirm, setTransferConfirm] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const myRole = useMemo(
    () => members.find((m) => m.userId === user?.id)?.role ?? null,
    [members, user?.id],
  );
  const isOwner = myRole === 'owner';

  const loadMembers = useCallback(async () => {
    if (!serverId) return;
    setMembersLoading(true);
    try {
      const serverMembers = await listServerMembers(serverId);
      const users: MeResponse[] = await authApi.getUsers(serverMembers.map((m) => m.userId));
      const userMap = new Map(users.map((u) => [u.id, u]));
      setMembers(serverMembers.map((m) => ({
        ...m,
        username: userMap.get(m.userId)?.username ?? 'Unknown user',
        avatarUrl: userMap.get(m.userId)?.avatarUrl ?? null,
      })));
    } catch (error) {
      toast.error('Failed to load members', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setMembersLoading(false);
    }
  }, [serverId, listServerMembers]);

  useEffect(() => {
    if (servers.length === 0) {
      fetchServers();
    }
  }, [servers.length, fetchServers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMembers();
  }, [loadMembers]);

  const [seededServerId, setSeededServerId] = useState<string | null>(null);
  const server = useMemo(() => servers.find((s) => s.id === serverId), [servers, serverId]);

  // Seed the overview + privacy forms when the server record first arrives.
  // Adjusting state during render (not in an effect) avoids the extra pass.
  if (server && seededServerId !== server.id) {
    setSeededServerId(server.id);
    setName(server.name);
    setIconUrl(server.iconUrl ?? '');
    setPolicy(server.channelCreationPolicy);
    setInviteToggle(server.memberInviteToggle);
  }

  if (!serverId || !server) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-8">
        <p className="text-text-muted text-sm">
          {servers.length === 0 ? 'Loading server…' : 'Server not found'}
        </p>
        <Button variant="ghost" onClick={() => navigate({ to: '/app' })}>
          Back to app
        </Button>
      </div>
    );
  }

  const handleSaveOverview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOverview(true);
    try {
      await updateServer(serverId, { name: name.trim(), iconUrl: iconUrl.trim() });
      toast.success('Server updated');
    } catch (error) {
      toast.error('Failed to update server', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSavingOverview(false);
    }
  };

  const handleSavePrivacy = async () => {
    setSavingPrivacy(true);
    try {
      await updateServer(serverId, { channelCreationPolicy: policy, memberInviteToggle: inviteToggle });
      toast.success('Privacy settings saved');
    } catch (error) {
      toast.error('Failed to save privacy settings', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleRoleChange = async (member: MemberRow, role: 'moderator' | 'member') => {
    setRoleSaving(member.userId);
    try {
      await updateMemberRole(serverId, member.userId, role);
      toast.success(`${member.username} is now ${role === 'moderator' ? 'a moderator' : 'a member'}`);
      loadMembers();
    } catch (error) {
      toast.error('Failed to change role', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setRoleSaving(null);
    }
  };

  const transferTarget = members.find((m) => m.userId === transferTargetId);

  const handleTransfer = async () => {
    if (!transferTarget || transferConfirm !== transferTarget.username) return;
    setTransferring(true);
    try {
      await transferOwnership(serverId, transferTarget.userId);
      toast.success(`Ownership transferred to ${transferTarget.username}`);
      setShowTransferDialog(false);
      setTransferConfirm('');
      setTransferTargetId('');
      loadMembers();
    } catch (error) {
      toast.error('Failed to transfer ownership', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setTransferring(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== server.name) return;
    setDeleting(true);
    try {
      await deleteServer(serverId);
      toast.success('Server deleted');
      navigate({ to: '/app' });
    } catch (error) {
      toast.error('Failed to delete server', error instanceof Error ? error.message : 'Unknown error');
      setDeleting(false);
    }
  };

  const sections: Array<{ id: Section; label: string; icon: typeof Users; ownerOnly?: boolean }> = [
    { id: 'overview', label: 'Overview', icon: Settings2 },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'invites', label: 'Invites', icon: Link2 },
    { id: 'privacy', label: 'Privacy', icon: Lock, ownerOnly: true },
    { id: 'danger', label: 'Danger zone', icon: Trash2, ownerOnly: true },
  ];
  const visibleSections = sections.filter((s) => !s.ownerOnly || isOwner);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg-base sm:flex-row">
      {/* Section nav */}
      <nav className="flex w-full shrink-0 flex-col gap-2 border-b border-border-subtle p-3 sm:w-56 sm:gap-1 sm:border-b-0 sm:border-r sm:p-4" aria-label="Server settings sections">
        <Link
          to="/app/$serverId"
          params={{ serverId }}
          className="flex min-w-0 items-center gap-2 px-2 py-1 text-sm text-text-secondary transition-colors hover:text-text-primary sm:mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="truncate">Back to {server.name}</span>
        </Link>
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
          {visibleSections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors sm:w-full',
                  section === s.id
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary',
                  s.id === 'danger' && section !== 'danger' && 'text-accent-warn hover:text-accent-warn'
                )}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Section content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-2xl">
          {section === 'overview' && (
            <div>
              <h1 className="text-xl font-semibold text-text-primary mb-1">Overview</h1>
              <p className="text-text-muted text-sm mb-6">Rename your server or change its icon.</p>

              {isOwner ? (
                <form onSubmit={handleSaveOverview} className="space-y-4">
                  <div>
                    <Label htmlFor="server-name">Server name</Label>
                    <Input
                      id="server-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="server-icon">Icon URL</Label>
                    <Input
                      id="server-icon"
                      value={iconUrl}
                      onChange={(e) => setIconUrl(e.target.value)}
                      placeholder="https://example.com/icon.png"
                      className="mt-1"
                    />
                  </div>
                  <Button type="submit" disabled={savingOverview || !name.trim()}>
                    {savingOverview ? 'Saving…' : 'Save changes'}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label>Server name</Label>
                    <p className="text-text-primary mt-1">{server.name}</p>
                  </div>
                  <p className="text-sm text-text-muted">Only the server owner can edit these settings.</p>
                </div>
              )}

              <Separator className="my-8" />
              <p className="text-xs text-text-muted">
                Created {new Date(server.createdAt).toLocaleDateString()}
              </p>
            </div>
          )}

          {section === 'members' && (
            <div>
              <h1 className="text-xl font-semibold text-text-primary mb-1">Members</h1>
              <p className="text-text-muted text-sm mb-6">
                {isOwner
                  ? 'Promote a member to moderator or demote a moderator back to member.'
                  : 'Everyone in this server.'}
              </p>

              {membersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
                </div>
              ) : (
                <div className="space-y-1">
                  {members.map((member) => (
                    <div key={member.userId} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-bg-raised">
                      {member.avatarUrl ? (
                        <img src={member.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div
                          className="h-9 w-9 rounded-full flex items-center justify-center font-medium text-white text-sm"
                          style={{ backgroundColor: getColorFromString(member.username) }}
                        >
                          {getInitials(member.username)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {member.username}
                          {member.userId === user?.id && (
                            <span className="text-text-muted font-normal"> (you)</span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted capitalize">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>
                      </div>

                      {member.role === 'owner' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-accent-owner/10 px-2 py-1 text-xs font-medium text-accent-owner">
                          <ShieldCheck className="h-3 w-3" />
                          Owner
                        </span>
                      ) : isOwner && member.userId !== user?.id ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member, e.target.value as 'moderator' | 'member')}
                          disabled={roleSaving === member.userId}
                          className="rounded-lg border border-border-subtle bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                          aria-label={`Role for ${member.username}`}
                        >
                          <option value="member">Member</option>
                          <option value="moderator">Moderator</option>
                        </select>
                      ) : (
                        <span className={cn(
                          'px-2 py-1 rounded text-xs font-medium',
                          member.role === 'moderator' ? 'bg-accent-info/10 text-accent-info' : 'bg-bg-raised text-text-muted'
                        )}>
                          {member.role === 'moderator' ? 'Moderator' : 'Member'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isOwner && (
                <>
                  <Separator className="my-8" />
                  <div className="flex items-start gap-3">
                    <UserCog className="h-5 w-5 text-text-muted mt-0.5" />
                    <div className="flex-1">
                      <h2 className="text-sm font-medium text-text-primary">Transfer ownership</h2>
                      <p className="text-xs text-text-muted mt-1">
                        Hands the server to another member. You become a moderator. This is immediate.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        onClick={() => setShowTransferDialog(true)}
                      >
                        Transfer ownership
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {section === 'invites' && (
            <div>
              <h1 className="text-xl font-semibold text-text-primary mb-1">Invites</h1>
              <p className="text-text-muted text-sm mb-6">One invite link per server. Regenerate to invalidate the old one.</p>
              <InvitePanel serverId={serverId} canManage={isOwner || myRole === 'moderator'} />
            </div>
          )}

          {section === 'privacy' && isOwner && (
            <div>
              <h1 className="text-xl font-semibold text-text-primary mb-1">Privacy</h1>
              <p className="text-text-muted text-sm mb-6">Control what regular members can do.</p>

              <div className="space-y-6">
                <div>
                  <h2 className="text-sm font-medium text-text-primary mb-3">Who can create channels</h2>
                  <RadioGroupRoot value={policy} onValueChange={(v) => setPolicy(v as ServerResponse['channelCreationPolicy'])} className="space-y-3">
                    {POLICY_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className="flex items-center gap-3 p-4 border border-border-subtle rounded-lg hover:bg-bg-raised/50 transition-colors cursor-pointer"
                      >
                        <RadioGroupItem value={opt.value} className="mt-0.5" />
                        <div>
                          <span className="font-medium text-text-primary text-sm">{opt.label}</span>
                          <p className="text-xs text-text-muted mt-0.5">{opt.description}</p>
                        </div>
                      </label>
                    ))}
                  </RadioGroupRoot>
                </div>

                <Separator />

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="invite-toggle"
                    checked={inviteToggle}
                    onCheckedChange={(v) => setInviteToggle(v === true)}
                    className="mt-1"
                  />
                  <div>
                    <Label htmlFor="invite-toggle" className="text-sm font-medium text-text-primary cursor-pointer">
                      Members can create invite links
                    </Label>
                    <p className="text-xs text-text-muted mt-1">
                      When off, only you and moderators can view or share the invite.
                    </p>
                  </div>
                </div>

                <Button onClick={handleSavePrivacy} disabled={savingPrivacy}>
                  {savingPrivacy ? 'Saving…' : 'Save privacy settings'}
                </Button>
              </div>
            </div>
          )}

          {section === 'danger' && isOwner && (
            <div>
              <h1 className="text-xl font-semibold text-accent-warn mb-1">Danger zone</h1>
              <p className="text-text-muted text-sm mb-6">Irreversible actions.</p>

              <div className="rounded-lg border border-accent-warn/30 bg-accent-warn/5 p-4">
                <h2 className="text-sm font-medium text-accent-warn flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete this server
                </h2>
                <p className="text-xs text-text-muted mt-2 mb-4">
                  Deleting {server.name} removes every channel, message, and invite. This cannot be undone.
                </p>
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                  Delete server
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transfer ownership dialog */}
      <DialogRoot open={showTransferDialog} onOpenChange={(open) => { setShowTransferDialog(open); if (!open) setTransferConfirm(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>
              {transferTarget
                ? `Type "${transferTarget.username}" to confirm. They become the owner; you become a moderator.`
                : 'Choose the member who should become the new owner.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="transfer-target">New owner</Label>
              <select
                id="transfer-target"
                value={transferTargetId}
                onChange={(e) => { setTransferTargetId(e.target.value); setTransferConfirm(''); }}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              >
                <option value="">Select a member…</option>
                {members
                  .filter((m) => m.userId !== user?.id && m.role !== 'owner')
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>{m.username}</option>
                  ))}
              </select>
            </div>
            {transferTarget && (
              <div>
                <Label htmlFor="transfer-confirm">Type "{transferTarget.username}" to confirm</Label>
                <Input
                  id="transfer-confirm"
                  value={transferConfirm}
                  onChange={(e) => setTransferConfirm(e.target.value)}
                  placeholder={transferTarget.username}
                  className="mt-1"
                  maxLength={100}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowTransferDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleTransfer}
              disabled={!transferTarget || transferConfirm !== transferTarget.username || transferring}
            >
              {transferring ? 'Transferring…' : 'Transfer ownership'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      {/* Delete server dialog */}
      <DialogRoot open={showDeleteDialog} onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setDeleteConfirm(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {server.name}</DialogTitle>
            <DialogDescription>
              This permanently deletes the server and all of its content. Type the server name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="delete-confirm">Type "{server.name}" to confirm</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={server.name}
              className="mt-1"
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConfirm !== server.name || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
