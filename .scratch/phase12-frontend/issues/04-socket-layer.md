# 04: Socket Layer — Connection, Reconnection, Event Bus

**What to build:** A robust `useSocket` hook wrapping `socket.io-client` with auto-reconnection, exponential backoff, authentication via cookie, and a typed event emitter for all backend WebSocket events. This is the single source of truth for real-time communication.

**Blocked by:** 01-project-setup, 03-auth-flow

**Status:** ready-for-agent

- [ ] `useSocket` hook (Zustand store or React context) exposing:
  - `socket: Socket | null`
  - `status: 'connecting' | 'connected' | 'disconnected' | 'error'`
  - `connect()` — initializes socket with `auth: {}` (cookie sent automatically), `transports: ['websocket', 'polling']`
  - `disconnect()` — clean disconnect
  - `emitWithAck<Request, Response>(event, payload, timeoutMs?)` — returns `Promise<Response>` for ack-based frames
  - `on<Event>(event, handler)` / `off(event, handler)` — typed event subscription
- [ ] Reconnection logic:
  - Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  - Max retries: infinite (until `disconnect()` called)
  - On reconnect: emit `catch_up` for all subscribed channels with last seen message IDs (from `useMessageStore`)
- [ ] Event types (matching backend):
  - `message_create` → `MessageResponse`
  - `message_update` → `MessageResponse`
  - `message_delete` → `MessageDeleteResponse`
  - `typing` → `TypingBroadcast` (channelId, userId)
  - `presence_online` → `{ userId: string }`
  - `presence_offline` → `{ userId: string }`
  - `channel_added` → `{ channelId: string }`
  - `channel_removed` → `{ channelId: string }`
  - `policy_violation` → `{ error: { code: 'TOO_MANY_VIOLATIONS', retryable: false } }`
- [ ] Idempotency key generation: `crypto.randomUUID()` per mutation
- [ ] Connection state persisted to `useSocketStore` (Zustand) for UI indicators
- [ ] `policy_violation` handler: shows toast "Disconnected: too many requests", forces re-auth (clear auth store, redirect to `/`)
- [ ] Development: log all sent/received events in console (dev only)
- [ ] Type-safe event map using TypeScript discriminated unions