# Huddle

Huddle is a real-time community chat app inspired by Discord. People create servers, organise conversations into channels, chat, and see who is online. The project focuses on two hard parts: live updates from server to browser, and permissions that combine server roles with channel rules.

## Main features

- GitHub sign-in and user profiles
- Servers, invites, memberships, and moderator roles
- Public and private channels with channel-level access rules
- Real-time messages, typing notices, and online presence
- Message history, editing, deleting, and reconnect catch-up

There is no voice, video, or bot support. Huddle is an npm workspaces monorepo with a NestJS API, React web app, and shared API/socket contracts.

## Documentation

Each guide describes behavior implemented in the current code.

| Guide | What it explains |
|---|---|
| [Backend architecture](docs/backend-architecture.md) | Backend modules and how a request moves through them. |
| [Frontend architecture](docs/frontend-architecture.md) | Web routes, state, API clients, and message transcript. |
| [HTTP API](docs/api.md) | REST endpoints, inputs, responses, and common errors. |
| [WebSockets](docs/websockets.md) | Socket connection lifecycle, events, acknowledgements, and reconnect. |
| [User flows](docs/flows.md) | Sign-in, joining, channel management, chat, and presence. |
| [Component communication](docs/communication.md) | Messages exchanged between browser, backend, and storage. |
| [Database](docs/database.md) | Postgres models, relationships, IDs, and migrations. |
| [Redis and temporary state](docs/caching.md) | Sessions, rate limits, presence, and short-lived chat state. |
| [Sign-in and permissions](docs/auth.md) | GitHub OAuth, sessions, roles, capabilities, and overrides. |
| [Local setup](docs/setup.md) | Run the app on localhost. |
| [Local and tunnel access](docs/deployment.md) | Use localhost or share the local app through Cloudflare Quick Tunnel. |
| [Tech stack](docs/tech-stack.md) | The technologies used and their purpose. |
| [Repository structure](docs/repo-structure.md) | Where the API, web app, contracts, and tests live. |
| [Glossary](docs/glossary.md) | Plain explanations of Huddle's domain terms. |

## Quick start

Requirements: Node.js 24, npm 10 or newer, Docker Compose, and a GitHub OAuth App. See [Local setup](docs/setup.md) for environment values and complete instructions.

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run db:up
npm run db:migrate
npm run dev
```

In another terminal, run `npm run dev -w @huddle/web`, then open `http://localhost:5173`. Fill in the GitHub OAuth values and `SESSION_SECRET` in `apps/api/.env` before starting the API. Run commands from the repository root; there is one npm lockfile.
