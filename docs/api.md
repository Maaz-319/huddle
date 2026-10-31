# HTTP API and contracts

The API is served by the NestJS app. In local development, Vite proxies requests to it. For a remote browser, keep API traffic on the web origin through that proxy or configure `VITE_API_URL` to the API origin.

Authenticated routes use the `connect.sid` session cookie. The browser client sends credentials automatically. IDs in paths, query strings, request bodies, and responses are decimal strings.

## Routes

`Session` means a valid signed-in session is required. Permission checks still apply after sign-in.

| Method and path | Session | Purpose and input |
|---|---|---|
| `GET /health` | No | Checks the app, Postgres, and Redis. |
| `GET /auth/github` | No | Starts GitHub sign-in and redirects to GitHub. |
| `GET /auth/github/callback` | OAuth flow | GitHub returns here; Huddle creates a session and redirects to the web app. |
| `GET /auth/me` | Yes | Returns the current user. |
| `PATCH /auth/me` | Yes | Optional `{ "bio": "..." }`; an empty string clears the bio. |
| `POST /auth/logout` | Yes | Ends this browser session. Returns `204`. |
| `DELETE /auth/me` | Yes | Soft-deletes the account and ends its sessions. Returns `204`. |
| `GET /auth/users?ids=id,id` | Yes | Gets profile summaries for the requested IDs. Unknown or deleted users are omitted. |
| `POST /servers` | Yes | Creates a server. Body: `{ "name": "...", "iconUrl"?: "https://..." }`. |
| `GET /servers` | Yes | Lists the caller's servers. |
| `GET /servers/:serverId` | Yes | Gets a server the caller belongs to. |
| `PATCH /servers/:serverId` | Yes, owner | Updates optional `name`, `iconUrl`, `channelCreationPolicy`, or `memberInviteToggle`. |
| `DELETE /servers/:serverId` | Yes, owner | Deletes a server and its channels. Returns `204`. |
| `GET /servers/:serverId/members` | Yes | Lists server members and roles. |
| `PATCH /servers/:serverId/members/:userId/role` | Yes, owner | Body: `{ "role": "moderator" }` or `{ "role": "member" }`. |
| `POST /servers/:serverId/transfer-ownership` | Yes, owner | Body: `{ "toUserId": "..." }`. Returns `204`. |
| `GET /servers/:serverId/invite` | Yes, member | Gets the invite if the caller's role and server settings allow it. |
| `DELETE /servers/:serverId/invite` | Yes, owner or moderator | Revokes the invite. Returns `204`. |
| `POST /servers/:serverId/invite/regenerate` | Yes, owner or moderator | Replaces the current invite and returns it. |
| `POST /servers/:serverId/channels` | Yes, allowed server role | Body: `{ "name": "...", "isPrivate": false }`. |
| `GET /servers/:serverId/channels` | Yes, server member | Lists channels the caller may view, with `myCapabilities`. |
| `GET /channels/:channelId` | Yes, can view | Gets channel details and the caller's effective capabilities. |
| `PATCH /channels/:channelId` | Yes, can manage settings | Updates optional `name` or `isPrivate`. |
| `DELETE /channels/:channelId` | Yes, can manage settings | Deletes the channel and its messages. Returns `204`. |
| `GET /channels/:channelId/members` | Yes, can manage settings | Lists private-channel members. Public channels return an empty list. |
| `POST /channels/:channelId/members` | Yes, can manage settings | Body: `{ "userId": "..." }`; adds a server member to a private channel. |
| `DELETE /channels/:channelId/members/:userId` | Yes, can manage settings | Removes a private-channel member. Returns `204`. |
| `GET /channels/:channelId/overrides` | Yes, can manage settings | Lists capability revocations for channel roles. |
| `PUT /channels/:channelId/overrides/:role/:capability` | Yes, can manage settings | Revokes the named capability. No body. Returns `204`. |
| `DELETE /channels/:channelId/overrides/:role/:capability` | Yes, can manage settings | Removes that revocation. Returns `204`. |
| `GET /invites/:code` | Yes | Previews the server named by an invite. |
| `POST /invites/:code/join` | Yes | Joins the server. Returns the server preview. |
| `GET /channels/:channelId/messages` | Yes, can view | Reads history. Query: `limit` (default 50, max 100), and either `before` or `after` message ID. |
| `POST /channels/:channelId/messages` | Yes, can post | Body: `{ "content": "..." }`; creates and broadcasts a message. |
| `PATCH /channels/:channelId/messages/:messageId` | Yes, author and can post | Body: `{ "content": "..." }`; edits the caller's message. |
| `DELETE /channels/:channelId/messages/:messageId` | Yes, can post | Deletes own message, or another message with `delete_others`. Returns `204`. |
| `GET /presence/snapshot?userIds=id,id` | Yes | Returns online IDs among users who share a server with the caller. |

Channel and server names are trimmed and limited to 1-100 characters. Message content is trimmed and limited to 1-2048 characters. Server icons must use HTTPS. The global validation pipe rejects unknown body fields.

## Common response shapes

The canonical shared response types are in `packages/contracts/src/http.ts`. Common examples:

```json
{ "id": "123", "username": "sam", "avatarUrl": "https://...", "email": "...", "bio": null }
```

The shared contract contains these response shapes:

| Type | Fields |
|---|---|
| `UserResponse` / `MeResponse` | `id`, `username`, `avatarUrl`, `email`, `bio` |
| `UserSummaryResponse` | `id`, `username`, `avatarUrl`, `bio` |
| `ServerResponse` | `id`, `name`, `iconUrl`, `channelCreationPolicy`, `memberInviteToggle`, `createdAt` |
| `MembershipResponse` / `ServerMemberResponse` | `userId`, `role`, `joinedAt` |
| `InviteResponse` | `code`, `revokedAt`, `createdAt` |
| `InvitePreviewResponse` | `server: { id, name, iconUrl }` |
| `ChannelResponse` | `id`, `serverId`, `name`, `isPrivate`, `createdAt`, `myCapabilities` |
| `ChannelMemberResponse` | `channelId`, `userId`, `addedAt` |
| `ChannelOverrideResponse` | `channelId`, `role`, `capability` |
| `MessageResponse` | `id`, `channelId`, `authorId`, `author: { id, username, avatarUrl }`, `content`, `createdAt`, `editedAt`, `isDeleted` |
| `MessageDeleteResponse` | `id`, `channelId` |
| `MessagePageResponse` | `messages`, `hasMore` |

Nullable fields are `bio`, `iconUrl`, `revokedAt`, `editedAt`, and deleted message `content`. Message pages are oldest-to-newest. `before` and `after` cannot be sent together; omitting both returns the newest page.

Errors use `{ "error": { "code": "...", "message": "...", "details"?: {} } }`. Common HTTP results include `400` invalid input, `401` no valid session, `403` known resource but action refused, `404` missing or intentionally hidden resource, `409` conflict, `429` rate limit, and `500` unexpected server error. A `429` includes a `Retry-After` header in seconds.

Many GET routes use the `read` rate limit. Mutations use `strict-mutation`; sign-in routes use `auth-ip`; message creation uses `message-send`. See [caching.md](caching.md) for how shared limits work.
