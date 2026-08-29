/**
 * connect-redis@6.1.3 ships no type declarations, and no @types package
 * exists for it. It's pinned to this old major deliberately: it is the last
 * version that is Redis-client-agnostic (plain callback calls, flattened
 * array arguments) rather than hard-depending on the `redis` package's v4+
 * API — the shape our ioredis-based `RedisService` needs. Its own
 * package.json lists `ioredis` as a devDependency, confirming the pairing is
 * intentional on their side too. This is a genuinely untyped third-party
 * boundary (AGENTS.md section 4); everything downstream of this one import
 * stays fully typed.
 */
declare module 'connect-redis' {
  import { Store } from 'express-session';

  interface RedisStoreOptions {
    client: unknown;
    prefix?: string;
    ttl?: number;
    disableTTL?: boolean;
    disableTouch?: boolean;
  }

  function connectRedis(session: {
    Store: abstract new (...args: never[]) => Store;
  }): new (options: RedisStoreOptions) => Store;

  export = connectRedis;
}
