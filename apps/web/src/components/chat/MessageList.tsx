import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect, useCallback, useMemo } from 'react';
import { Message } from './Message';
import { buildTranscriptRows, startsAuthorGroup } from './messageGrouping';
import type { MessageResponse } from '@/types/socket';

interface MessageListProps {
  messages: MessageResponse[];
  isOwn: (authorId: string) => boolean;
  canPost?: boolean;
  canDeleteOthers?: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onCopy: (content: string) => void;
  onRetry: (messageId: string) => Promise<void>;
  onDiscard: (messageId: string) => void;
  onLoadOlder: () => void | Promise<void>;
  hasMore: boolean;
  loading: boolean;
  scrolledToBottom: boolean;
  setScrolledToBottom: (value: boolean) => void;
  /** Increment to command a programmatic scroll-to-bottom. */
  scrollToBottomSignal?: number;
}

const OLDER_BANNER_HEIGHT = 40;
const DATE_DIVIDER_ESTIMATED_HEIGHT = 30;
const MESSAGE_ROW_ESTIMATED_HEIGHT = 72;

export function MessageList({
  messages,
  isOwn,
  canPost = true,
  canDeleteOthers = false,
  onEdit,
  onDelete,
  onCopy,
  onRetry,
  onDiscard,
  onLoadOlder,
  hasMore,
  loading,
  scrolledToBottom,
  setScrolledToBottom,
  scrollToBottomSignal = 0,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const loadOlderRef = useRef(false);
  const transcriptRows = useMemo(() => buildTranscriptRows(messages), [messages]);
  // Scroll-position anchor captured just before a prepend so the viewport
  // stays on the messages the user was reading.
  const anchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const virtualizer = useVirtualizer({
    count: transcriptRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => transcriptRows[index]?.kind === 'date'
      ? DATE_DIVIDER_ESTIMATED_HEIGHT
      : MESSAGE_ROW_ESTIMATED_HEIGHT,
    overscan: 8,
    paddingStart: hasMore ? OLDER_BANNER_HEIGHT : 0,
  });

  const triggerLoadOlder = useCallback(() => {
    if (!parentRef.current || loadOlderRef.current || !hasMore) return;
    loadOlderRef.current = true;
    anchorRef.current = {
      scrollHeight: parentRef.current.scrollHeight,
      scrollTop: parentRef.current.scrollTop,
    };
    onLoadOlder();
    // Re-arm after a short delay to prevent multiple triggers
    setTimeout(() => { loadOlderRef.current = false; }, 500);
  }, [hasMore, onLoadOlder]);

  // After prepended messages commit, shift scrollTop by the height delta so
  // the transcript doesn't jump under the reader.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || !parentRef.current) return;
    const delta = parentRef.current.scrollHeight - anchor.scrollHeight;
    if (delta > 0) {
      parentRef.current.scrollTop = anchor.scrollTop + delta;
    }
    anchorRef.current = null;
  }, [messages]);

  // Handle scroll to load older messages / track bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;

    // Load older when scrolled to top
    if (scrollTop === 0 && hasMore && !loadOlderRef.current) {
      triggerLoadOlder();
    }

    // Track if user is at bottom for auto-scroll
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    setScrolledToBottom(atBottom);
  }, [hasMore, triggerLoadOlder, setScrolledToBottom]);

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (scrolledToBottom && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length, scrolledToBottom]);

  // Programmatic scroll-to-bottom (FAB click) — ignores current position
  useEffect(() => {
    if (scrollToBottomSignal > 0 && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
      setScrolledToBottom(true);
    }
  }, [scrollToBottomSignal, setScrolledToBottom]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="scrollbar-hidden flex-1 min-h-0 overflow-y-auto relative"
    >
      {/* Load older trigger at top — in flow so it never covers the first row */}
      {hasMore && (
        <div
          className="sticky top-0 z-10 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm"
          style={{ height: OLDER_BANNER_HEIGHT }}
        >
          <button
            onClick={triggerLoadOlder}
            disabled={loadOlderRef.current || loading}
            className="text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      )}

      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = transcriptRows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.kind === 'date' ? `date-${row.dayKey}` : row.message.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.kind === 'date' ? (
                <div
                  role="separator"
                  aria-label={row.label}
                  className="flex items-center gap-3 px-4 py-1.5 text-xs text-text-muted"
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
                  <time dateTime={row.dayKey}>{row.label}</time>
                  <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
                </div>
              ) : (
                <Message
                  message={row.message}
                  showAuthor={startsAuthorGroup(messages, row.messageIndex)}
                  isOwn={isOwn(row.message.authorId)}
                  canPost={canPost}
                  canDeleteOthers={canDeleteOthers}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCopy={onCopy}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Loading skeleton at bottom */}
      {loading && messages.length === 0 && (
        <div className="p-8">
          <div className="animate-pulse space-y-3 max-w-md mx-auto">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-bg-raised" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-bg-raised rounded w-1/4" />
                  <div className="h-4 bg-bg-raised rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
