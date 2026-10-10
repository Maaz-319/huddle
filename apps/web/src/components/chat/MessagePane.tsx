import { useState, useCallback } from 'react';
import { useChannelStore } from '@/stores/channelStore';
import { useAuthStore } from '@/stores/authStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useMessages, useTyping } from '@/hooks/useMessages';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { EmptyMessages } from './EmptyMessages';

export function MessagePane() {
  const { currentChannelId } = useChannelStore();
  const { user } = useAuthStore();
  const { isOnline } = usePresenceStore();
  
  const [scrolledToBottom, setScrolledToBottom] = useState(true);
  const [typingUsers] = useState<string[]>([]);

  const {
    messages,
    pending,
    hasMore,
    loading,
    sendMessage,
    editMessage,
    deleteMessage,
    loadOlder,
  } = useMessages(currentChannelId);

  const { startTyping, stopTyping } = useTyping(currentChannelId);

  // Track online status of typing users
  const onlineTypingUsers = typingUsers.filter(id => isOnline(id));

  // Check if we should show empty state
  const showEmptyState = !currentChannelId || (messages.length === 0 && pending.length === 0 && !loading);

  const handleSend = useCallback(async (content: string) => {
    await sendMessage(content);
  }, [sendMessage]);

  const handleEdit = useCallback(async (messageId: string, content: string) => {
    await editMessage(messageId, content);
  }, [editMessage]);

  const handleDelete = useCallback(async (messageId: string) => {
    await deleteMessage(messageId);
  }, [deleteMessage]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    // Could show a toast here
  }, []);

  const isOwn = useCallback((authorId: string) => {
    return authorId === user?.id || authorId === 'current-user';
  }, [user?.id]);

  if (!currentChannelId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
          <h1 className="text-text-primary font-semibold">Messages</h1>
        </div>
        <EmptyMessages />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <span className="text-accent-primary font-bold text-lg">
              #{currentChannelId.slice(0, 4)}
            </span>
          </div>
          <div>
            <h1 className="text-text-primary font-semibold">Channel</h1>
            <p className="text-text-muted text-sm">{messages.length + pending.length} messages</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Density toggle could go here */}
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-hidden relative">
        {showEmptyState && !loading ? (
          <EmptyMessages />
        ) : (
          <>
            <MessageList
              messages={messages}
              isOwn={isOwn}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onCopy={handleCopy}
              onLoadOlder={loadOlder}
              hasMore={hasMore}
              loading={loading}
              scrolledToBottom={scrolledToBottom}
              setScrolledToBottom={setScrolledToBottom}
            />
            {/* Typing indicator */}
            {onlineTypingUsers.length > 0 && (
              <TypingIndicator typingUsers={onlineTypingUsers} />
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onTypingStart={startTyping}
        onTypingStop={stopTyping}
        disabled={!currentChannelId}
        placeholder="Message #channel..."
      />
    </div>
  );
}