# WebSockets

Huddle uses one Socket.IO connection per browser session for chat, typing, presence, access notices, and reconnect catch-up. The API authenticates the handshake with the same cookie session as HTTP.

## Connection lifecycle

1. The API rate-limits the attempt and resolves the cookie to a signed-in user. Refusals carry `AUTH_REQUIRED`, `RATE_LIMITED` (with `retryAfter`), or `REFUSED` codes.
2. On success, the gateway computes channels the user may view and joins those channel rooms. It registers the socket with presence.
3. Socket.IO ping/pong heartbeats refresh presence. The gateway also checks that the session remains active; logout, account deletion, or lost access can close or reconcile the socket.
4. The web client retries transient disconnects with backoff. It waits `retryAfter` after a rate-limited handshake, refreshes auth once after an auth refusal, and stops automatic retries after a terminal refusal.
5. After reconnect, the transcript asks for messages newer than its last known ID. A truncated catch-up triggers a normal history load.

## Client events

All IDs are strings. Mutating events include an idempotency key. The sender gets a Socket.IO acknowledgement; message changes are also broadcast to the room.

| Event | Payload | Result |
|---|---|---|
| `message_send` | `{ channelId, content, idempotencyKey }` | Ack with `messageId`, `createdAt`, and key; broadcast `message_create`. |
| `message_edit` | `{ channelId, messageId, content, idempotencyKey }` | Ack with `messageId`, `editedAt`, and key; broadcast `message_update`. |
| `message_delete` | `{ channelId, messageId, idempotencyKey }` | Ack with message ID and key; broadcast `message_delete`. |
| `typing` | `{ channelId }` | Ack; at most one broadcast per user and channel each three seconds. |
| `catch_up` | `{ channels: [{ channelId, afterMessageId }] }` | Ack with visible channels and their newer messages. |

Failures use `{ error: { code, retryable } }`. Message send, edit, and delete are deduplicated for 30 seconds by user, operation, and key. Catch-up accepts at most 200 channel entries and returns up to 200 messages per channel. A hidden or inaccessible requested channel is omitted.

## Server events

| Event | Purpose |
|---|---|
| `message_create` | A message was added. |
| `message_update` | A message was edited. |
| `message_delete` | A message was deleted. |
| `typing` | A channel member is typing. |
| `presence_online`, `presence_offline` | A user's aggregate connection status changed. |
| `channel_added`, `channel_removed` | This user's visible channel rooms changed. |
| `membership_changed` | Refresh membership information for a server. |
| `policy_violation` | Repeated socket rate-limit refusals caused a disconnect. |

Event names and payload types are shared in `packages/contracts/src/socket.ts`. Channel rooms are created from server-verified access, not client subscription requests.
