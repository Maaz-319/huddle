import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect, useCallback } from 'react';
import { Message } from './Message';
import { ScrollAreaComp } from '@/components/ui/scroll-area';
import type { MessageResponse } from '@/types/socket';

interface MessageListProps {
  messages: MessageResponse[];
  isOwn: (authorId: string) => boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onCopy: (content: string) => void;
  onLoadOlder: () => void;
  hasMore: boolean;
  loading: boolean;
  scrolledToBottom: boolean;
  setScrolledToBottom: (value: boolean) => void;
}

export function MessageList({
  messages,
  isOwn,
  onEdit,
  onDelete,
  onCopy,
  onLoadOlder,
  hasMore,
  loading,
  scrolledToBottom,
  setScrolledToBottom,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const loadOlderRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
    paddingStart: 0,
    paddingEnd: 0,
  });

  // Handle scroll to load older messages
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    
    // Load older when scrolled to top
    if (scrollTop === 0 && hasMore && !loadOlderRef.current) {
      loadOlderRef.current = true;
      onLoadOlder();
      // Reset after a short delay to prevent multiple triggers
      setTimeout(() => { loadOlderRef.current = false; }, 500);
    }
    
    // Track if user is at bottom for auto-scroll
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    setScrolledToBottom(atBottom);
  }, [hasMore, onLoadOlder, setScrolledToBottom]);

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (scrolledToBottom && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length, scrolledToBottom]);

  // Reverse messages for virtualizer (newest at bottom)
  const virtualItems = virtualizer.getVirtualItems();
  const reversedMessages = [...messages].reverse();

  return (
    <ScrollAreaComp className="flex-1">
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Load older trigger at top */}
        {hasMore && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={onLoadOlder}
              disabled={loadOlderRef.current || loading}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              {loading ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          style={{
            position: 'absolute',
            top: hasMore ? '40px' : 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column-reverse',
          }}
        >
          {virtualItems.map((virtualRow) => (
            <div
              key={reversedMessages[virtualRow.index]?.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {reversedMessages[virtualRow.index] && (
                <Message
                  message={reversedMessages[virtualRow.index]}
                  isOwn={isOwn(reversedMessages[virtualRow.index].authorId)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCopy={onCopy}
                />
              )}
            </div>
          ))}
        </div>

        {/* Empty state */}
        {messages.length === 0 && !loading && !hasMore && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              padding: '2rem',
            }}
          >
            <div className="text-text-muted text-sm">No messages yet. Start the conversation!</div>
          </div>
        )}

        {/* Loading skeleton at bottom */}
        {loading && messages.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
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
    </ScrollAreaComp>
  );
}