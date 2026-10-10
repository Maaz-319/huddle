import { cn } from '@/components/ui/cn';
import { useServerStore } from '@/stores/serverStore';

interface Member {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: 'owner' | 'moderator' | 'member';
  status: 'online' | 'offline' | 'idle' | 'dnd';
}

const mockMembers: Member[] = [
  { id: '1', username: 'Alice', avatarUrl: null, role: 'owner', status: 'online' },
  { id: '2', username: 'Bob', avatarUrl: null, role: 'moderator', status: 'online' },
  { id: '3', username: 'Charlie', avatarUrl: null, role: 'member', status: 'idle' },
  { id: '4', username: 'Diana', avatarUrl: null, role: 'member', status: 'offline' },
  { id: '5', username: 'Eve', avatarUrl: null, role: 'member', status: 'dnd' },
];

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

function getStatusColor(status: Member['status']): string {
  switch (status) {
    case 'online': return 'bg-green-500';
    case 'idle': return 'bg-yellow-500';
    case 'dnd': return 'bg-red-500';
    default: return 'bg-gray-500';
  }
}

function getRoleBadge(role: Member['role']) {
  switch (role) {
    case 'owner':
      return <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400 rounded-full">Owner</span>;
    case 'moderator':
      return <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400 rounded-full">Mod</span>;
    default:
      return null;
  }
}

export function MemberSidebar() {
  const { currentServerId } = useServerStore();
  const members = mockMembers;

  if (!currentServerId) {
    return (
      <div className="flex flex-col h-full w-64 bg-bg-base border-l border-border-subtle">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-sm">Select a server</p>
        </div>
      </div>
    );
  }

  const onlineMembers = members.filter(m => m.status === 'online');
  const offlineMembers = members.filter(m => m.status !== 'online');

  return (
    <div className={cn(
      'flex flex-col h-full bg-bg-base border-l border-border-subtle transition-all duration-200',
      'w-64',
      'lg:w-64'
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h2>
        <span className="text-text-muted text-xs">{members.length}</span>
      </div>
      
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1" role="navigation" aria-label="Members">
        {onlineMembers.length > 0 && (
          <>
            <h3 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Online ({onlineMembers.length})
            </h3>
            {onlineMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg">
                <div className="relative">
                  {member.avatarUrl ? (
                    <img 
                      src={member.avatarUrl} 
                      alt="" 
                      className="h-8 w-8 rounded-full object-cover" 
                    />
                  ) : (
                    <div 
                      className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
                      style={{ backgroundColor: getColorFromString(member.username) }}
                    >
                      {getInitials(member.username)}
                    </div>
                  )}
                  <span className={cn(
                    'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg-base',
                    getStatusColor(member.status)
                  )} />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="truncate font-medium text-sm text-text-primary">{member.username}</span>
                  {getRoleBadge(member.role)}
                </div>
              </div>
            ))}
          </>
        )}
        {offlineMembers.length > 0 && (
          <>
            <h3 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Offline ({offlineMembers.length})
            </h3>
            {offlineMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-raised rounded-lg">
                <div className="relative">
                  {member.avatarUrl ? (
                    <img 
                      src={member.avatarUrl} 
                      alt="" 
                      className="h-8 w-8 rounded-full object-cover opacity-50" 
                    />
                  ) : (
                    <div 
                      className="h-8 w-8 rounded-full flex items-center justify-center font-medium text-white text-sm opacity-50"
                      style={{ backgroundColor: getColorFromString(member.username) }}
                    >
                      {getInitials(member.username)}
                    </div>
                  )}
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg-base bg-gray-500" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="truncate font-medium text-sm text-text-secondary">{member.username}</span>
                  {getRoleBadge(member.role)}
                </div>
              </div>
            ))}
          </>
        )}
      </nav>
    </div>
  );
}