import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { MoreVertical, Edit, Trash2, Copy } from 'lucide-react';
import { 
  DropdownMenuRoot, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import type { MessageResponse } from '@/types/socket';

interface MessageProps {
  message: MessageResponse;
  isOwn: boolean;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
  onCopy?: (content: string) => void;
}

export function Message({ message, isOwn, onEdit, onDelete, onCopy }: MessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isDeleted = message.isDeleted === true;
  const isPending = message.pending === true;

  const handleSaveEdit = async () => {
    if (onEdit && editContent.trim() && editContent !== message.content) {
      try {
        await onEdit(message.id, editContent);
        setIsEditing(false);
      } catch (error) {
        console.error('Failed to edit message:', error);
      }
    } else {
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return '';
    }
  };

  const absoluteTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return '';
    }
  };

  return (
    <div
      className={cn(
        'group relative flex gap-3 px-4 py-2',
        'hover:bg-bg-raised/50',
        isPending && 'opacity-60',
        isDeleted && 'text-text-muted italic'
      )}
      data-message-id={message.id}
    >
      <div className="relative flex-shrink-0 w-8 h-8">
        {message.author.avatarUrl ? (
          <img
            src={message.author.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-white text-sm"
            style={{
              backgroundColor: `hsl(${message.author.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360}, 70%, 45%)`,
            }}
          >
            {message.author.username.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-text-primary">{message.author.username}</span>
          {message.author.id === 'current-user' && (
            <span className="text-xs text-text-muted px-1.5 py-0.5 bg-bg-raised rounded">You</span>
          )}
          <time
            className="text-xs text-text-muted whitespace-nowrap"
            dateTime={message.createdAt}
            title={absoluteTime(message.createdAt)}
          >
            {formatTimestamp(message.createdAt)}
          </time>
          {message.editedAt && (
            <span
              className="text-xs text-text-muted"
              title={absoluteTime(message.editedAt)}
            >
              (edited)
            </span>
          )}
        </div>

        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            autoFocus
            rows={3}
            className="w-full min-h-[44px] max-h-[60vh] px-3 py-2 bg-bg-raised border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-electric resize-none"
            placeholder="Edit message..."
          />
        ) : (
          <div
            className={cn(
              'text-text-primary whitespace-pre-wrap break-words',
              'max-w-[calc(100%-2rem)]',
              isDeleted && 'text-text-muted italic'
            )}
          >
            {message.content}
          </div>
        )}

        {!isEditing && (isOwn || message.author.id === 'current-user') && (
          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 -mr-2 h-6 w-6 p-0"
                aria-label="Message options"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              {!isDeleted && (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      setIsEditing(true);
                      setEditContent(message.content);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onCopy?.(message.content)}
                    className="flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Text
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => onDelete?.(message.id)}
                className="flex items-center gap-2 text-red-400 focus:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        )}
      </div>
    </div>
  );
}