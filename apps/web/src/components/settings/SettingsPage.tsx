import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroupRoot, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from '@/stores/toastStore';
import { Loader2, User, Shield, LogOut, Trash2, Palette, ArrowLeft } from 'lucide-react';

export function SettingsPage() {
  const { user, logout, deleteAccount } = useAuthStore();
  const navigate = useNavigate();
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [density, setDensity] = useState<'compact' | 'cozy'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('messageDensity') as 'compact' | 'cozy') ?? 'compact';
    }
    return 'compact';
  });
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Apply the stored density on load — Message rows read --msg-gap.
  useEffect(() => {
    document.documentElement.style.setProperty('--msg-gap', density === 'compact' ? '4px' : '12px');
  }, [density]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await apiClient.patch('/auth/me', { bio });
      toast.success('Profile updated', 'Your bio has been saved');
    } catch (error) {
      toast.error('Failed to update', 'Could not save your bio');
    } finally {
      setSaving(false);
    }
  };

  const handleDensityChange = (value: 'compact' | 'cozy') => {
    setDensity(value);
    localStorage.setItem('messageDensity', value);
    document.documentElement.style.setProperty('--msg-gap', value === 'compact' ? '4px' : '12px');
    toast.success('Density updated', `Message density set to ${value}`);
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success('Account deleted', 'Your account has been permanently deleted');
    } catch (error) {
      toast.error('Failed to delete', 'Could not delete your account');
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto max-w-2xl mx-auto w-full p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: '/app' })}
          aria-label="Back to app"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
          <p className="text-text-muted text-sm mt-1">Manage your account, appearance, and preferences</p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="inline-flex h-auto p-1 gap-1 bg-bg-raised rounded-lg max-w-full overflow-x-auto">
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="h-4 w-4 mr-2" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="account">
            <Shield className="h-4 w-4 mr-2" />
            Account
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="h-24 w-24 rounded-full object-cover"
                />
              ) : (
                <div
                  className="h-24 w-24 rounded-full flex items-center justify-center font-bold text-white text-3xl"
                  style={{
                    backgroundColor: `hsl(${user!.username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360}, 70%, 45%)`,
                  }}
                >
                  {user!.username.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{user?.username}</h2>
              <p className="text-text-muted text-sm">{user?.email}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div>
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                maxLength={300}
                rows={4}
                className="mt-1"
              />
              <div className="flex justify-between">
                <p className="text-xs text-text-muted">{bio.length}/300</p>
                <Button
                  onClick={handleSaveProfile}
                  disabled={saving || bio === user?.bio}
                  className="ml-auto"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    'Save Bio'
                  )}
                </Button>
              </div>
            </div>

            <div>
              <Label>Username</Label>
              <Input
                value={user?.username ?? ''}
                disabled
                className="mt-1 bg-bg-base text-text-muted"
              />
              <p className="text-xs text-text-muted mt-1">Username is synced from GitHub and cannot be changed</p>
            </div>

            <div>
              <Label>Avatar</Label>
              <p className="text-xs text-text-muted mt-1">Your avatar comes from GitHub and cannot be changed here</p>
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={user?.email ?? ''}
                disabled
                className="mt-1 bg-bg-base text-text-muted"
              />
              <p className="text-xs text-text-muted mt-1">Email is synced from GitHub and cannot be changed</p>
            </div>
          </div>
        </TabsContent>

        {/* Appearance Tab */}
        <TabsContent value="appearance" className="mt-6 space-y-6">
          <div>
            <h3 className="text-lg font-medium text-text-primary mb-4">Message Density</h3>
            <p className="text-text-muted text-sm mb-4">Control how compact messages appear in chat</p>

            <RadioGroupRoot value={density} onValueChange={handleDensityChange} className="space-y-3">
              <div className="flex items-center gap-3 p-4 border border-border-subtle rounded-lg hover:bg-bg-raised/50 transition-colors cursor-pointer">
                <RadioGroupItem value="compact" className="mt-0.5" />
                <div className="flex-1">
                  <label className="font-medium text-text-primary cursor-pointer">Compact</label>
                  <p className="text-xs text-text-muted mt-0.5">Tighter spacing, more messages visible (Discord-like)</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 border border-border-subtle rounded-lg hover:bg-bg-raised/50 transition-colors cursor-pointer">
                <RadioGroupItem value="cozy" className="mt-0.5" />
                <div className="flex-1">
                  <label className="font-medium text-text-primary cursor-pointer">Cozy</label>
                  <p className="text-xs text-text-muted mt-0.5">More breathing room between messages</p>
                </div>
              </div>
            </RadioGroupRoot>
          </div>

          <Separator />

          <div>
            <h3 className="text-lg font-medium text-text-primary mb-4">Preview</h3>
            <div className="border border-border-subtle rounded-lg overflow-hidden" style={{ '--msg-gap': density === 'compact' ? '4px' : '12px' } as React.CSSProperties}>
              <div className="p-4 space-y-3" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--msg-gap)' }}>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-accent-primary/20 flex items-center justify-center" />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-sm">User</span>
                      <span className="text-xs text-text-muted">2h ago</span>
                    </div>
                    <p className="text-text-primary">This is how messages look with the selected density setting.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-accent-electric/20 flex items-center justify-center" />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-sm">Another User</span>
                      <span className="text-xs text-text-muted">1h ago</span>
                    </div>
                    <p className="text-text-primary">Compact shows more messages on screen. Cozy gives more breathing room.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Account Tab */}
        <TabsContent value="account" className="mt-6 space-y-6">
          <div className="border border-border-subtle rounded-lg p-4 bg-bg-base/50">
            <h3 className="font-medium text-text-primary mb-2">Log Out</h3>
            <p className="text-text-muted text-sm mb-4">Sign out of your account on this device. You can sign back in anytime.</p>
            <Button variant="secondary" onClick={handleLogout} className="w-full sm:w-auto">
              <LogOut className="h-4 w-4 mr-2" />
              Log Out
            </Button>
          </div>

          <div className="border border-accent-warn/30 rounded-lg p-4 bg-red-950/20">
            <h3 className="font-medium text-accent-warn mb-2 flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Account
            </h3>
            <p className="text-text-muted text-sm mb-4">
              This permanently deletes your account. Your messages will remain but show as "Deleted User".
              This action cannot be undone.
            </p>
            <DialogRoot open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Account</DialogTitle>
                  <DialogDescription>
                    This action is irreversible. Please type "DELETE" to confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="deleteConfirm">Type "DELETE" to confirm</Label>
                    <Input
                      id="deleteConfirm"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE"
                      className="mt-1 font-mono"
                      maxLength={6}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirm !== 'DELETE' || deleting}
                    >
                      {deleting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Deleting...
                        </>
                      ) : (
                        'Delete Account'
                      )}
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </DialogRoot>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}