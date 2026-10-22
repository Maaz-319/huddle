import { cn } from '@/components/ui/cn';
import { useUIStore } from '@/stores/uiStore';
import { Hash, Users, MessageSquare, Server, Menu, X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';

export function BottomNav() {
  const { activeMobileTab, setActiveMobileTab, setChannelListOpen, setMemberSidebarOpen, setServerListOpen, closeAllDrawers } = useUIStore();

  const tabs = [
    { id: 'servers', icon: Server, label: 'Servers' },
    { id: 'channels', icon: Hash, label: 'Channels' },
    { id: 'messages', icon: MessageSquare, label: 'Messages' },
    { id: 'members', icon: Users, label: 'Members' },
  ] as const;

  return (
    <div className="lg:hidden relative z-40 bg-bg-raised border-t border-border-subtle safe-area-bottom">
      <div className="flex h-16 items-center justify-around px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeMobileTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant="ghost"
              size="icon"
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-1.5',
                'text-text-secondary',
                isActive && 'text-accent-primary bg-accent-primary/10'
              )}
              onClick={() => {
                setActiveMobileTab(tab.id);
                switch (tab.id) {
                  case 'servers':
                    setServerListOpen(true);
                    break;
                  case 'channels':
                    setChannelListOpen(true);
                    break;
                  case 'members':
                    setMemberSidebarOpen(true);
                    break;
                  case 'messages':
                    closeAllDrawers();
                    break;
                }
              }}
              aria-label={tab.label}
              aria-selected={isActive}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function MobileHeader() {
  const { activeMobileTab, setChannelListOpen, setMemberSidebarOpen, setServerListOpen } = useUIStore();
  const navigate = useNavigate();

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
          <Button variant="ghost" size="icon" onClick={() => setServerListOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        );
      case 'channels':
        return (
          <Button variant="ghost" size="icon" onClick={() => setChannelListOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        );
      case 'members':
        return (
          <Button variant="ghost" size="icon" onClick={() => setMemberSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        );
      default:
        return (
          <Button variant="ghost" size="icon" onClick={() => setServerListOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        );
    }
  };

  const getRightAction = () => {
    if (activeMobileTab === 'servers') {
      return (
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/app/settings' })} aria-label="Your settings">
          <User className="h-5 w-5" />
        </Button>
      );
    }
    return null;
  };

  return (
    <div className="lg:hidden relative z-40 h-16 flex-shrink-0 bg-bg-raised border-b border-border-subtle flex items-center justify-between px-4 safe-area-top">
      <div className="flex items-center gap-4">
        {getLeftAction()}
        <h1 className="text-text-primary font-semibold text-base truncate">{getTitle()}</h1>
      </div>
      <div className="flex items-center gap-2">
        {getRightAction()}
      </div>
    </div>
  );
}