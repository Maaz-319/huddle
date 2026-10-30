import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { MoreVertical, Edit, Trash2, Copy, X, AlertCircle } from 'lucide-react';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import type { MessageResponse } from '@/types/socket';
import { getInitials, getColorFromString } from '@/utils/avatar';

interface MessageProps {
  message: MessageResponse;
  /** Whether this row begins an author group and should show author identity. */
  showAuthor?: boolean;
  isOwn: boolean;
  canPost?: boolean;
  canDeleteOthers?: boolean;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
  onCopy?: (content: string) => void;
  onRetry?: (messageId: string) => Promise<void>;
  onDiscard?: (messageId: string) => void;
}

export function Message({ message, showAuthor = true, isOwn, canPost = true, canDeleteOthers = false, onEdit, onDelete, onCopy, onRetry, onDiscard }: MessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content ?? '');
  const [editFailed, setEditFailed] = useState(false);

  const isDeleted = message.isDeleted === true;
  const isPending = message.pending === true;
  const isFailed = message.failed === true;
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    if (!message.uncertain || !message.retryExpiresAt) return;
    const wait = message.retryExpiresAt - Date.now();
    const timer = window.setTimeout(() => setExpiryTick((tick) => tick + 1), Math.max(0, wait) + 25);
    return () => window.clearTimeout(timer);
  }, [message.uncertain, message.retryExpiresAt]);
  const requiresResend = message.uncertain && (!message.retryExpiresAt || expiryTick > 0);

  const handleSaveEdit = async () => {
    if (!onEdit || !editContent.trim() || editContent === message.content) {
      setIsEditing(false);
      setEditFailed(false);
      return;
    }
    try {
      await onEdit(message.id, editContent);
      setIsEditing(false);
      setEditFailed(false);
    } catch {
      // Stay in edit mode so the draft isn't lost; surface the failure.
      setEditFailed(true);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(message.content ?? '');
    setIsEditing(false);
    setEditFailed(false);
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
      return format(new Date(timestamp), 'h:mm a');
    } catch {
      return '';
    }
  };

  return (
    <div
      className={cn(
        'group relative flex gap-3 pr-2',
        'hover:bg-bg-raised/50',
        isPending && 'opacity-60',
        isFailed && 'opacity-80',
        isDeleted && 'text-text-muted italic'
      )}
      style={{ paddingBlock: 'var(--msg-gap, 8px)', paddingLeft: '1rem' }}
      data-message-id={message.id}
    >
      {showAuthor && (
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
              style={{ backgroundColor: getColorFromString(message.author.username) }}
            >
              {getInitials(message.author.username)}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0" style={{ marginLeft: showAuthor ? undefined : '2.75rem' }}>
        {showAuthor && (
          <div className="flex items-baseline justify-between gap-3 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-medium text-sm text-text-primary truncate">{message.author.username}</span>
              {isOwn && (
                <span className="text-xs text-text-muted px-1.5 py-0.5 bg-bg-raised rounded">You</span>
              )}
            </div>
            <div className="flex items-baseline gap-2 flex-shrink-0">
              <time
                className="text-xs text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity"
                dateTime={message.createdAt}
              >
                {formatTimestamp(message.createdAt)}
              </time>
              {message.editedAt && !isPending && (
                <span
                  className="text-xs text-text-muted"
                >
                  (edited)
                </span>
              )}
            </div>
          </div>
        )}

        {!showAuthor && (
          <span className="float-right ml-2 text-xs text-text-muted whitespace-nowrap">
            <time
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              dateTime={message.createdAt}
            >
              {formatTimestamp(message.createdAt)}
            </time>
            {message.editedAt && !isPending && (
              <span className="ml-1">(edited)</span>
            )}
          </span>
        )}

        {isEditing ? (
          <div className={cn(showAuthor && 'mt-1', 'space-y-1.5')}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              rows={3}
              className="w-full min-h-[44px] max-h-[40vh] px-3 py-2 bg-bg-raised border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-electric resize-none"
              placeholder="Edit message..."
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={!editContent.trim() || editContent === message.content}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                Cancel
              </Button>
              {editFailed && (
                <span className="text-xs text-accent-warn flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Failed to save
                </span>
              )}
              <span className="text-xs text-text-muted ml-auto">Esc to cancel</span>
            </div>
          </div>
        ) : (
          <div className={cn('text-text-primary whitespace-pre-wrap break-words', isDeleted && 'text-text-muted italic')}>
            {isDeleted ? 'message deleted' : message.content}
          </div>
        )}

        {isFailed && !isEditing && (
          <div className="flex items-center gap-2 mt-1 text-xs text-accent-warn">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{message.uncertain ? 'Delivery is uncertain.' : 'Failed to send.'}</span>
            {onRetry && (
              <button
                onClick={() => onRetry(message.id)}
                className="underline hover:text-text-primary transition-colors"
              >
                {requiresResend ? 'Resend' : 'Retry'}
              </button>
            )}
            {onDiscard && (
              <button
                onClick={() => onDiscard(message.id)}
                className="underline hover:text-text-primary transition-colors"
              >
                Discard
              </button>
            )}
          </div>
        )}
      </div>

      {/* Action gutter — reserved width so the menu never covers content.
          Hidden until hover on desktop; always visible on touch. */}
      <div className="flex-shrink-0 w-8 self-start mt-0.5">
        {!isEditing && !isDeleted && (
          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 p-0',
                  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity',
                  'pointer-coarse:opacity-100'
                )}
                aria-label="Message options"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              {message.content && (
                <DropdownMenuItem
                  onClick={() => onCopy?.(message.content ?? '')}
                  className="flex items-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Copy text
                </DropdownMenuItem>
              )}
              {isOwn && canPost && !isFailed && !isPending && (
                <DropdownMenuItem
                  onClick={() => {
                    setIsEditing(true);
                    setEditContent(message.content ?? '');
                  }}
                  className="flex items-center gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}
              {isOwn && canPost && !isFailed && !isPending && <DropdownMenuSeparator />}
              {((isOwn && canPost) || canDeleteOthers) && !isFailed && !isPending && (
                <DropdownMenuItem
                  onClick={() => onDelete?.(message.id)}
                  className="flex items-center gap-2 text-red-400 focus:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenuRoot>
        )}
        {isFailed && onDiscard && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 p-0 text-text-muted hover:text-accent-warn pointer-coarse:opacity-100 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => onDiscard(message.id)}
            aria-label="Discard failed message"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
