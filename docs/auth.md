# Sign-in and permissions

Authentication answers “who is this user?” Authorization answers “what may this user do here?” Huddle uses GitHub OAuth to establish identity, a Redis-backed cookie session to remember it, and server-side role and capability checks to authorize actions.

## GitHub sign-in and sessions

1. The browser opens `GET /auth/github`.
2. Passport redirects the user to GitHub. GitHub returns to the configured callback with an authorization code and OAuth state.
3. Huddle verifies the callback, syncs the GitHub profile, rotates the pre-login session, saves the user ID in Redis, and redirects to `WEB_ORIGIN/app`.
4. The browser sends the `HttpOnly` `connect.sid` cookie on later requests. In production it is `Secure`; it uses `SameSite=Lax` and a sliding seven-day lifetime.
5. REST guards and the WebSocket handshake resolve that session to a current, non-deleted user. The client never chooses its trusted user ID.

Logout ends the current browser session. Account deletion is a soft delete; other sessions stop resolving to a valid user and connected sockets are closed.

## Server roles

Roles belong to a person within a server.

| Role | Main authority |
|---|---|
| Owner | Controls the server, invites, roles, and ownership transfer. Always has every channel capability. |
| Moderator | Manages channels, invites, and moderation within its permission rules. |
| Member | Reads and posts where allowed. May create channels only when server policy allows. |

Server channel creation policy is `owner_only`, `mods_only`, or `everyone`. The server invite setting controls whether members can view/share the invite.

## Channel capabilities

Default capabilities before channel overrides:

| Role | `view` | `post` | `delete_others` | `manage_settings` |
|---|---:|---:|---:|---:|
| Owner | Yes | Yes | Yes | Yes |
| Moderator | Yes | Yes | Yes | Yes |
| Member | Yes | Yes | No | No |

An override row revokes one capability for `moderator` or `member`. Overrides can only remove access from the role's defaults. They cannot grant access, and the owner cannot be overridden. A private channel is hidden from everyone without a channel-member entry, except the server owner.

Editing requires the message author and `post`. Deleting one's own message requires `post`; deleting someone else's requires `delete_others`. Server checks remain on the backend even when the web app hides unavailable actions. Inaccessible or hidden channels return `404` to avoid revealing that they exist.
