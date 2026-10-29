import { useState, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { Hash, PanelLeft, Users, ArrowDown } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useUIStore } from '@/stores/uiStore';
import { useTyping } from '@/hooks/useMessages';
import { useChannelTranscript } from '@/transcript/channelTranscript';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { Button } from '@/components/ui/button';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { EmptyMessages } from './EmptyMessages';

export function MessagePane() {
  const params = useParams({ strict: false }) as { serverId?: string; channelId?: string };
  const currentChannelId = params.channelId ?? null;
  const { user } = useAuthStore();
  const { servers } = useServerStore();
  const { channelsByServer } = useChannelStore();
  const { isChannelListOpen, isMemberSidebarOpen, toggleChannelList, toggleMemberSidebar } = useUIStore();

  const [scrolledToBottom, setScrolledToBottom] = useState(true);
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);

  const {
    messages,
    hasMore,
    loading,
    error,
    gap,
    retrySync,
    sendMessage,
    retryMessage,
    discardFailedMessage,
    editMessage,
    deleteMessage,
    loadOlder,
  } = useChannelTranscript(currentChannelId);

  const { startTyping, stopTyping, typingUsernames } = useTyping(currentChannelId);
  const permissions = useMyPermissions(params.serverId ?? null, currentChannelId);
  const canPost = permissions.can('post');
  const canDeleteOthers = canPost && permissions.can('delete_others');

  // Real channel/server identity for the header
  const channel = currentChannelId
    ? (channelsByServer.get(params.serverId ?? '') ?? []).find((c) => c.id === currentChannelId)
    : null;
  const server = params.serverId
    ? servers.find((s) => s.id === params.serverId)
    : null;

  // Check if we should show empty state
  const showEmptyState = !currentChannelId || (messages.length === 0 && !loading && !error);

  const handleSend = useCallback(async (content: string) => {
    await sendMessage(content);
  }, [sendMessage]);

  const handleRetry = useCallback(async (messageId: string) => {
    await retryMessage(messageId);
  }, [retryMessage]);

  const handleDiscard = useCallback((messageId: string) => {
    discardFailedMessage(messageId);
  }, [discardFailedMessage]);

  const handleEdit = useCallback(async (messageId: string, content: string) => {
    await editMessage(messageId, content);
  }, [editMessage]);

  const handleDelete = useCallback(async (messageId: string) => {
    await deleteMessage(messageId);
  }, [deleteMessage]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const isOwn = useCallback((authorId: string) => {
    return authorId === user?.id;
  }, [user?.id]);

  const handleScrollToBottom = useCallback(() => {
    setScrollToBottomSignal((n) => n + 1);
  }, []);

  if (!currentChannelId) {
    return (
      <div className="flex flex-col h-full">
        <div className="hidden h-16 items-center justify-between border-b border-border-subtle px-4 lg:flex">
          <h1 className="text-text-primary font-semibold">Messages</h1>
        </div>
        <EmptyMessages hasChannels={(channelsByServer.get(params.serverId ?? '') ?? []).length > 0} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="hidden h-16 items-center justify-between border-b border-border-subtle px-4 lg:flex">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
            <Hash className="h-5 w-5 text-accent-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-text-primary font-semibold truncate">
              {channel?.name ?? 'Channel'}
            </h1>
            {server && (
              <p className="text-text-muted text-sm truncate">{server.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={isChannelListOpen ? 'text-text-primary' : 'text-text-muted'}
            onClick={toggleChannelList}
            aria-label={isChannelListOpen ? 'Hide channel list' : 'Show channel list'}
            aria-pressed={isChannelListOpen}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={isMemberSidebarOpen ? 'text-text-primary' : 'text-text-muted'}
            onClick={toggleMemberSidebar}
            aria-label={isMemberSidebarOpen ? 'Hide member list' : 'Show member list'}
            aria-pressed={isMemberSidebarOpen}
          >
            <Users className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-accent-warn/40 bg-accent-warn/10 px-4 py-2 text-xs text-accent-warn" role="alert">
            <span>{error}</span>
            <button type="button" className="shrink-0 underline" onClick={() => void retrySync().catch(() => {})}>Retry</button>
          </div>
        )}
        {gap && !error && (
          <p className="border-b border-border-subtle bg-bg-raised px-4 py-2 text-center text-xs text-text-muted" role="status">
            Latest messages loaded after a long gap. Scroll up to see older history.
          </p>
        )}
        {error && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted">
            Messages are unavailable. Use Retry above to load this channel.
          </div>
        ) : showEmptyState && !loading ? (
          <EmptyMessages hasChannels />
        ) : (
          <>
            <MessageList
              messages={messages}
              isOwn={isOwn}
              canPost={canPost}
              canDeleteOthers={canDeleteOthers}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onCopy={handleCopy}
              onRetry={handleRetry}
              onDiscard={handleDiscard}
              onLoadOlder={loadOlder}
              hasMore={hasMore}
              loading={loading}
              scrolledToBottom={scrolledToBottom}
              setScrolledToBottom={setScrolledToBottom}
              scrollToBottomSignal={scrollToBottomSignal}
            />
            {/* Typing indicator */}
            {typingUsernames.length > 0 && (
              <TypingIndicator typingUsers={typingUsernames} />
            )}
            {/* Scroll to bottom */}
            {!scrolledToBottom && (
              <Button
                variant="secondary"
                size="icon"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full shadow-lg bg-bg-overlay border border-border-subtle"
                onClick={handleScrollToBottom}
                aria-label="Scroll to latest messages"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      {canPost && (
        <Composer
          onSend={handleSend}
          onTypingStart={startTyping}
          onTypingStop={stopTyping}
          disabled={!currentChannelId}
          placeholder={`Message #${channel?.name ?? 'channel'}`}
        />
      )}
    </div>
  );
}
