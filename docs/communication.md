# Communication between components

This guide shows how parts of Huddle exchange information. It complements [flows.md](flows.md), which follows user actions.

## HTTP request

```mermaid
sequenceDiagram
  participant Browser
  participant Nest as NestJS pipeline
  participant Guard as Session and permission guards
  participant Controller
  participant Service
  participant Adapter
  participant PG as Postgres or Redis
  Browser->>Nest: HTTP request with cookie
  Nest->>Guard: Validate session and access
  Guard-->>Nest: Allow or return an error
  Nest->>Controller: Valid request
  Controller->>Service: Call operation
  Service->>Adapter: Use repository or state port
  Adapter->>PG: Query or update data
  PG-->>Adapter: Result
  Adapter-->>Service: Domain data
  Service-->>Controller: Operation result
  Controller-->>Browser: JSON or empty 204 response
```

## Live message

```mermaid
sequenceDiagram
  participant Sender
  participant Gateway as Socket.IO gateway
  participant Limit as Rate limiter
  participant Chat as Chat service
  participant DB as Postgres
  participant Room as Channel room
  participant Peers as Other clients
  Sender->>Gateway: message_send + acknowledgement callback
  Gateway->>Limit: Spend message-send token
  Gateway->>Chat: Validate access and save message
  Chat->>DB: Insert message
  DB-->>Chat: Saved message
  Gateway-->>Sender: Acknowledgement
  Gateway->>Room: Broadcast message_create
  Room-->>Peers: New message
```

## Access change

Administration writes the membership, private-channel member, or override change to Postgres. It emits an internal application event. The gateway checks connected users' current access, updates their channel rooms, then sends `channel_added`, `channel_removed`, or `membership_changed` notices. The API does not trust a client's previous permissions for later operations.

## Storage roles

- **Postgres** stores accounts, servers, memberships, channels, invites, overrides, and messages.
- **Redis** stores sessions and short-lived coordination state such as rate-limit buckets, active socket presence, and chat retry keys.
- **GitHub** verifies OAuth sign-in and supplies the profile synced by Huddle.
