import { useState, useEffect } from 'react';
import { cn } from '@/components/ui/cn';

interface TypingIndicatorProps {
  typingUsers: string[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typingUsers.length > 0) {
      setVisible(true);
    } else {
      // Add a small delay before hiding for smoother UX
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [typingUsers.length]);

  if (!visible || typingUsers.length === 0) return null;

  const formatTypingText = (users: string[]) => {
    if (users.length === 1) {
      return `${users[0]} is typing...`;
    } else if (users.length === 2) {
      return `${users[0]} and ${users[1]} are typing...`;
    } else {
      return `${users[0]} and ${users.length - 1} others are typing...`;
    }
  };

  return (
    <div
      className={cn(
        'animate-in fade-in slide-in-from-bottom-2 duration-200',
        'px-4 py-1 text-xs text-text-muted'
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="flex items-center gap-1">
        <span className="flex gap-0.5">
          <span className="w-1.5 h-1.5 bg-accent-electric rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 bg-accent-electric rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 bg-accent-electric rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
        <span>{formatTypingText(typingUsers)}</span>
      </span>
    </div>
  );
}