import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import connectRedis from 'connect-redis';
import { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import { EnvironmentVariables, NodeEnv } from '../common/env.validation';
import { RedisService } from '../common/redis.service';

/** A week, in milliseconds — the sliding session lifetime. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** connect-redis's factory pattern: pass it `express-session` to get the class. */
const RedisStore = connectRedis(session);

/**
 * Registers `express-session`, backed by the existing Redis connection.
 *
 * This is a confirmed, documented exception to the port/adapter convention
 * (AGENTS.md section 2), the same status as the socket.io exception
 * (docs/architecture/repo-structure.md section 4): `express-session` +
 * `connect-redis` is the real, end-to-end session mechanism, not a hand-rolled
 * `SessionStore` port. See docs/architecture/auth-service.md section 3.
 *
 * Applied via `AuthModule.configure()`, not `main.ts`, so it is active when
 * e2e tests build the app straight from `AppModule` (same reasoning
 * `CommonModule` documents for its own `APP_GUARD`/`APP_FILTER`).
 *
 * `rolling: true` is what gives the sliding 7-day expiry `auth-service.md`
 * section 3 asks for — every request that touches the session pushes its
 * expiry back out, with no separate "touch" logic needed.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    redis: RedisService,
  ) {
    this.handler = session({
      store: new RedisStore({ client: redis, prefix: 'huddle:sess:' }),
      secret: config.get('SESSION_SECRET', { infer: true }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        // A Secure cookie is silently dropped over local plain HTTP, so this
        // must stay conditional on NODE_ENV (same pattern TRUSTED_PROXY_HOPS
        // already uses).
        secure: config.get('NODE_ENV', { infer: true }) === NodeEnv.Production,
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_MS,
      },
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.handler(req, res, next);
  }
}
