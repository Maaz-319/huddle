# Local setup

This guide runs Huddle on one computer using localhost. For access from another device through Cloudflare, see [deployment.md](deployment.md).

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm 10 or newer
- Docker with Docker Compose
- A GitHub OAuth App for sign-in

## Start the app

Run commands from the repository root:

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run db:up
```

Set these API values in `apps/api/.env`:

- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from your GitHub OAuth App.
- `GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback`, matching that app's callback URL.
- `SESSION_SECRET`, a private random value. Create one with `openssl rand -hex 32`.
- Keep `WEB_ORIGIN=http://localhost:5173` for local use.

All API variables are required and checked when the server starts: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `TRUSTED_PROXY_HOPS`, `LOG_LEVEL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, and `SESSION_SECRET`. The local values for the database and Redis must match `docker-compose.yml`.

The web uses `VITE_API_URL`, `API_PROXY_TARGET`, `WEB_PORT`, and `WEB_ALLOWED_HOSTS`. Keep `VITE_API_URL` empty for local proxy routing and `API_PROXY_TARGET=http://localhost:3000`. `WEB_PORT` is `5173`; leave `WEB_ALLOWED_HOSTS` empty for localhost. The web environment variables are validated by Vite when it starts or builds.

Then run:

```sh
npm run db:migrate
npm run dev
```

In a second terminal, run `npm run dev -w @huddle/web`. Open `http://localhost:5173`. The API is at `http://localhost:3000`; `GET /health` checks the app, database, and Redis.

## Useful commands

| Command | Purpose |
|---|---|
| `npm run db:up` | Start local Postgres and Redis. |
| `npm run db:down` | Stop containers and keep the Postgres volume. |
| `npm run db:migrate` | Apply/create local migrations. |
| `npm test` | API unit tests. |
| `npm run test:web` | Web tests. |
| `npm run test:e2e` | API end-to-end tests. |

`npm run db:reset` deletes local database volumes. Do not use it if you need to keep local data. Install dependencies from the repo root; there is one root lockfile.
