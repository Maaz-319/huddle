# Glossary

- **Capability:** A specific action allowed in a channel, such as viewing, posting, or managing settings.
- **Channel room:** A Socket.IO group containing the connected users allowed to see a channel.
- **Channel transcript:** The ordered view of one channel's messages, including loaded history, pending sends, live updates, and reconnect catch-up. Typing and presence are separate temporary views.
- **Idempotency key:** A short-lived key that lets a retried socket mutation receive its original result instead of repeating the change.
- **Membership:** A user's place and role in a server.
- **Override:** A channel rule that revokes a capability from a role. It cannot grant a capability.
- **Presence:** Whether a user has one or more active connections right now.
- **Snowflake:** A 64-bit ID that also carries creation-time ordering. Huddle sends it as a string to browsers.
- **Token bucket:** A rate-limit counter that refills over time and allows a small burst of actions.
