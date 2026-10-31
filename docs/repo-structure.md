# Repository structure

Huddle is an npm workspaces monorepo. Run package scripts from the root unless a command explicitly names a workspace.

```text
apps/
  api/          NestJS backend, Prisma schema, migrations, and API tests
  web/          React application and web tests
packages/
  contracts/    HTTP and Socket.IO types shared by API and web
docker/         Local Postgres initialization
docs/           Project and technical guides
```

## API source

`apps/api/src/` is grouped by Nest module: `auth/`, `administration/`, `chat/`, `presence/`, `rate-limiter/`, `health/`, and shared `common/` code. Controllers and gateways are transport entry points; services hold product rules; repository ports define storage needs; `adapters/` connect those ports to Prisma or Redis. `main.ts` configures the app and `app.module.ts` assembles modules.

## Web source

`apps/web/src/` contains `components/`, `routes` in `router.tsx`, `api/` clients, `stores/`, `hooks/`, `transcript/`, shared `types/`, and `utils/`. UI components are grouped by feature rather than by technical layer.

## Shared contracts and tests

`packages/contracts/src/` defines permission values and HTTP/socket wire types. The API unit and integration/e2e tests live under `apps/api/src/` and `apps/api/test/`. Web tests sit beside source files under `apps/web/src/`.

Prisma schema and generated migrations live under `apps/api/prisma/`. The generated Prisma client is ignored by Git and rebuilt during install. `.env` files are local secrets; the committed `.env.example` files describe required configuration.
