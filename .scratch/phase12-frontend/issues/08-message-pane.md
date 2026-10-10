# 08: Message Pane — History, Send, Edit, Delete, Typing, Pagination

**What to build:** The core chat experience — paginated message history (oldest→newest), composer with send/edit/delete, typing indicator, optimistic updates, reconnect catch-up. Compact density default (Discord-like).

**Blocked by:** 04-socket-layer, 05-app-shell, 07-channel-management

**Status:** ready-for-agent

- [ ] `useMessageStore` (Zustand) with:
  - `messagesByChannel: Map<channelId, MessageResponse[]>` — oldest→newest
  - `pendingMessages: Map<idempotencyKey, MessageResponse>` — optimistic sends
  - `hasMoreByChannel: Map<channelId, boolean>` — for pagination
  - `fetchHistory(channelId, { before?, after?, limit? })` — `GET /channels/:id/messages`
  - `sendMessage(channelId, content)` — optimistic add with `pending: true`, idempotency key → `socket.emitWithAck('message_send', ...)` → replace on ack
  - `editMessage(channelId, messageId, content)` — optimistic update → `socket.emitWithAck('message_edit', ...)` → rollback on error
  - `deleteMessage(channelId, messageId)` — optimistic remove (show "message deleted") → `socket.emitWithAck('message_delete', ...)` → rollback on error
  - `onMessageCreate(message)` — insert at end (if current channel)
  - `onMessageUpdate(message)` — replace in place
  - `onMessageDelete({ id, channelId })` — replace with deleted placeholder
  - `markChannelRead(channelId)` — track last read (future: unread badges)
- [ ] `MessagePane` component:
  - `MessageList` — virtualized (react-window or TanStack Virtual) for performance
  - Each `Message` component:
    - Avatar (author), username, timestamp (relative: "2h ago", absolute on hover)
    - Content: plain text, `isDeleted` → "message deleted" (muted, italic)
    - `editedAt` → "(edited)" badge next to timestamp
    - Hover → `⋮` menu (author: Edit, Delete; owner/mod: Delete)
    - Edit mode: inline textarea, `Enter` save, `Escape` cancel, `Shift+Enter` newline
  - `TypingIndicator` — "User is typing…" above composer, auto-clears 5s after last `typing` event
  - `Composer` (fixed bottom):
    - Textarea: auto-resize (min 44px, max ~40% viewport)
    - `Enter` send, `Shift+Enter` newline
    - Character counter (2048 max, muted → warn at 90%)
    - Send button (primary, disabled if empty/whitespace)
    - On send: `sendMessage()` → clear textarea
  - Scroll behavior:
    - New message while scrolled to bottom → auto-scroll
    - New message while scrolled up → "New messages" toast (click to scroll)
    - Scroll to top → fetch older (`?before=firstMessageId`) → prepend
  - Reconnect catch-up: on `socket.status === 'connected'` after disconnect, `socket.emitWithAck('catch_up', { channels: [{ channelId, afterMessageId: lastId }] })` → prepend missing messages, set `truncated` flag if `hasMore`
- [ ] Density toggle (Compact/Cozy) — stored in `localStorage`, applies CSS variable `--msg-gap` (Compact: 4px, Cozy: 12px)
- [ ] Empty state: "No messages yet. Start the conversation!"
- [ ] Loading state: skeleton rows while fetching history
- [ ] Error boundary per `MessagePane` (catches render errors, shows "Failed to load messages" with retry)