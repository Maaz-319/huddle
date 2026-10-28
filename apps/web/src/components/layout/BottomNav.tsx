import { cn } from '@/components/ui/cn';
import { useUIStore } from '@/stores/uiStore';
import { Hash, Users, MessageSquare, Server, Menu, X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';

export function BottomNav({ hasServers }: { hasServers: boolean }) {
  const { activeMobileTab, setActiveMobileTab, setChannelListOpen, setMemberSidebarOpen, setServerListOpen, closeAllDrawers } = useUIStore();

  const tabs = [
    { id: 'servers', icon: Server, label: 'Servers' },
    { id: 'channels', icon: Hash, label: 'Channels' },
    { id: 'messages', icon: MessageSquare, label: 'Messages' },
    { id: 'members', icon: Users, label: 'Members' },
  ] as const;
  const visibleTabs = hasServers
    ? tabs
    : tabs.filter((tab) => tab.id === 'servers' || tab.id === 'messages');

  return (
    <nav aria-label="Mobile navigation" className="relative z-40 border-t border-border-subtle bg-bg-raised safe-area-bottom lg:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeMobileTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant="ghost"
              size="icon"
              className={cn(
                'min-h-11 min-w-[4.25rem] flex-col gap-1 px-2 py-1.5',
                'text-text-secondary',
                isActive && 'text-accent-primary bg-accent-primary/10'
              )}
              onClick={() => {
                setActiveMobileTab(tab.id);
                switch (tab.id) {
                  case 'servers':
                    setChannelListOpen(false);
                    setMemberSidebarOpen(false);
                    setServerListOpen(true);
                    break;
                  case 'channels':
                    setServerListOpen(false);
                    setMemberSidebarOpen(false);
                    setChannelListOpen(true);
                    break;
                  case 'members':
                    setServerListOpen(false);
                    setChannelListOpen(false);
                    setMemberSidebarOpen(true);
                    break;
                  case 'messages':
                    closeAllDrawers();
                    break;
                }
              }}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{tab.label}</span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileHeader() {
  const {
    activeMobileTab,
    setActiveMobileTab,
    setChannelListOpen,
    setMemberSidebarOpen,
    setServerListOpen,
  } = useUIStore();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string; channelId?: string };
  const { servers } = useServerStore();
  const { channelsByServer } = useChannelStore();

  const currentServer = servers.find((server) => server.id === params.serverId);
  const currentChannel = params.serverId && params.channelId
    ? (channelsByServer.get(params.serverId) ?? []).find((channel) => channel.id === params.channelId)
    : undefined;

  const getTitle = () => {
    switch (activeMobileTab) {
      case 'servers':
        return 'Servers';
      case 'channels':
        return 'Channels';
      case 'messages':
        return 'Messages';
      case 'members':
        return 'Members';
    }
  };

  const getLeftAction = () => {
    switch (activeMobileTab) {
      case 'servers':
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setServerListOpen(false);
              setActiveMobileTab('messages');
            }}
            aria-label="Close servers"
          >
            <X className="h-5 w-5" />
          </Button>
        );
      case 'channels':
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setChannelListOpen(false);
              setActiveMobileTab('messages');
            }}
            aria-label="Close channels"
          >
            <X className="h-5 w-5" />
          </Button>
        );
      case 'members':
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setMemberSidebarOpen(false);
              setActiveMobileTab('messages');
            }}
            aria-label="Close members"
          >
            <X className="h-5 w-5" />
          </Button>
        );
      default:
        return (
          <Button variant="ghost" size="icon" onClick={() => setServerListOpen(true)} aria-label="Open servers">
            <Menu className="h-5 w-5" />
          </Button>
        );
    }
  };

  const getRightAction = () => {
    return (
      <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/app/settings' })} aria-label="Your settings">
        <User className="h-5 w-5" />
      </Button>
    );
  };

  const title = activeMobileTab === 'messages'
    ? currentChannel
      ? `# ${currentChannel.name}`
      : currentServer?.name ?? 'Huddle'
    : getTitle();

  return (
    <div className="lg:hidden relative z-40 h-16 flex-shrink-0 bg-bg-raised border-b border-border-subtle flex items-center justify-between px-4 safe-area-top">
      <div className="flex items-center gap-4">
        {getLeftAction()}
        <h1 className="min-w-0 truncate text-base font-semibold text-text-primary">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {getRightAction()}
      </div>
    </div>
  );
}
