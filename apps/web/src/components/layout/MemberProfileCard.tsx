import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { PopoverContent } from '@/components/ui/popover';
import { getInitials, getColorFromString } from '@/utils/avatar';

interface MemberProfileCardProps {
  username: string;
  avatarUrl: string | null;
  roleBadge: ReactNode;
  bio: string | null;
  joinedAt: string;
  isOnline: boolean;
}

export function MemberProfileCard({
  username,
  avatarUrl,
  roleBadge,
  bio,
  joinedAt,
  isOnline,
}: MemberProfileCardProps) {
  return (
    <PopoverContent side="left" align="start" className="w-64">
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center font-medium text-white flex-shrink-0"
            style={{ backgroundColor: getColorFromString(username) }}
          >
            {getInitials(username)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-semibold text-sm text-text-primary">{username}</span>
            {roleBadge}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                'h-2 w-2 rounded-full flex-shrink-0',
                isOnline ? 'bg-accent-primary' : 'bg-accent-offline',
              )}
            />
            <span className="text-xs text-text-muted">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border-subtle">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">About</p>
        {bio ? (
          <p className="mt-1.5 text-sm text-text-secondary whitespace-pre-wrap break-words">
            {bio}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-text-muted italic">No bio yet.</p>
        )}
        <p className="mt-3 text-xs text-text-muted">
          Member since {new Date(joinedAt).toLocaleDateString()}
        </p>
      </div>
    </PopoverContent>
  );
}
