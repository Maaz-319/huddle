# Redis and temporary state

Redis is a fast store for temporary state. In Huddle it is more than a page cache: some records coordinate sessions, rate limits, presence, and safe socket retries. Postgres remains the durable source for application data.

| State | Key pattern or use | Expiry and effect if lost |
|---|---|---|
| Login sessions | `huddle:sess:<session id>` through `connect-redis` | Sliding seven-day cookie lifetime. Loss signs the user out. |
| Rate-limit buckets | `huddle:rl:<policy>:<dimension>:<id>` | Expires as the bucket refills. Loss gives a fresh bucket. |
| Presence connections | `huddle:presence:connections:<userId>` and `huddle:presence:online-users` | Socket heartbeat window is about 30 seconds. Loss may briefly show a user offline. |
| Socket mutation acknowledgements | `huddle:chat:<operation>:<userId>:<key>` | 30 seconds. Loss can allow a retried send/edit/delete to run again. |
| Typing debounce | Per-user and per-channel short key | Three seconds. Loss can allow an extra typing event. |
| Repeated rate-limit violations | Per-user counter | One minute. Loss clears the escalation count. |

## Rate limits

The API and sockets use the same Redis token-bucket algorithm. Redis Lua makes refill and spend one atomic action, so concurrent requests cannot spend the same token twice.

| Policy | Burst and refill | Keyed by |
|---|---|---|
| `message-send` | 5 tokens, 1 per second | Channel |
| `typing` | 10 tokens, 2 per second | Channel, after a 3-second per-user/channel debounce |
| `auth-ip` | 5 tokens, 5 per minute | IP address |
| `strict-mutation` | 3 tokens, 3 per minute | Signed-in user; IP before sign-in |
| `read` | 60 tokens, 1 per second | Signed-in user; IP without a session |
| `ws-connect` | 5 tokens, 5 per minute | IP address |

HTTP refusals return `429` with `Retry-After`. Socket event refusals return an acknowledgement error and do not immediately close the connection. Five socket rate-limit refusals for the same user within one minute cause a `policy_violation` notice and disconnect that socket.

Redis runs without persistence locally. That is deliberate: all Redis data is temporary. A Redis restart clears sessions and temporary protections, but does not erase messages or other Postgres data.
