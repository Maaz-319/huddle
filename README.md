# Huddle

A simplified Discord. Users create servers, organise conversations into channels, chat
in real time, and see who is currently online. No voice, no video, no bots — just the
core of how a live community chat app works: a server that **pushes** updates the
instant something happens, and a permission system with real depth (server-level roles
plus per-channel overrides that can only tighten, never loosen).

## Documentation

The design is written down before it is built. Start with
[`docs/overview.md`](docs/overview.md) for the product and
[`docs/PRD.md`](docs/PRD.md) for the requirements; the component and stack decisions
live in [`docs/architecture/`](docs/architecture/), and the work is sequenced into 13
phases in [`docs/plans/CompletePlan.md`](docs/plans/CompletePlan.md).

Conventions for writing code in this repo are in [`AGENTS.md`](AGENTS.md).

## Layout

An npm workspaces monorepo:

- `apps/api` — the NestJS + socket.io backend. This is the whole project until Phase 12.
- `apps/web` — the React frontend. A placeholder package; deferred to Phase 12.

## Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc))
- **npm** 10 or newer, which ships with Node 22
- **Docker**, for the local Postgres and Redis

## Getting started

```
git clone https://github.com/Maaz-319/huddle.git
cd huddle
npm install
npm run db:up
cp .env.example .env
npm run dev
```

Run every command from the repo root — the workspaces resolve from there, and there is
a single `package-lock.json` at the root. Never run `npm install` inside `apps/*`.

`npm run dev` starts the API in watch mode on port 3000.

## Local infrastructure

Postgres and Redis run in Docker, defined in [`docker-compose.yml`](docker-compose.yml).
Postgres keeps a named volume; Redis deliberately runs with persistence off, because
everything it holds in this project is ephemeral.

| Script | What it does |
|---|---|
| `npm run db:up` | Start Postgres and Redis in the background |
| `npm run db:down` | Stop both containers, keeping the Postgres volume |
| `npm run db:reset` | Tear down **including volumes** and come back up empty |

First boot creates two databases: `huddle` for development and `huddle_test` for the
integration tests, so a test run can never truncate your development data. That happens
via [`docker/init.sql`](docker/init.sql), which the Postgres image runs only when the
data volume is empty — so editing it later requires a `db:reset` to take effect.

> `db:reset` drops volumes. Only ever run it against local Docker.
