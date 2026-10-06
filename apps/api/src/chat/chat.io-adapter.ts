import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions, Socket } from 'socket.io';
import type { Server } from 'socket.io';
import { resolveSessionUser } from '../auth/resolve-session-user';
import { SessionMiddleware } from '../auth/session.middleware';
import { UserRepository } from '../auth/user-repository.interface';
import type { User } from '../auth/user-repository.interface';
import { EnvironmentVariables } from '../common/env.validation';
import { resolveClientIp } from '../common/trust-proxy';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';

/** What the handshake puts on every socket — identity, from the handshake only. */
export interface SocketIdentity {
  user: User;
}

/**
 * A socket whose handshake completed: `data.user` is set before any
 * connection handler or message handler ever sees it, and no later frame may
 * name a different user (chat-service.md section 2).
 */
export type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketIdentity
>;

/** The socket.io server whose sockets all carry a resolved user. */
export type AuthenticatedServer = Server<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketIdentity
>;

/**
 * The `connect_error` a refused handshake produces. socket.io forwards
 * `message` and `data` verbatim to the client — there is no HTTP status code
 * and no `Retry-After` header on a WebSocket handshake
 * (docs/architecture/rate-limiter.md section 6).
 */
class ConnectError extends Error {
  constructor(
    message: string,
    readonly data: { retryAfter: number },
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

/**
 * The socket.io side of the handshake, registered in `io.use()` so both
 * checks run **before** a connection exists, in this order:
 *
 * 1. `ws-connect` rate limit, keyed on the client's address resolved through
 *    the same `trust proxy` hop count Express uses for `req.ip`
 *    (`resolveClientIp`) — never `socket.handshake.address`, never a raw
 *    `X-Forwarded-For` entry;
 * 2. session resolution: the existing `express-session` handler run over the
 *    upgrade request, then the three `resolveSessionUser` checks REST's
 *    `SessionAuthGuard` runs — one function, so the two transports can never
 *    disagree about who is logged in (#64's AC).
 *
 * A custom `IoAdapter` is where socket.io's server instance exists, so this
 * is where the middleware chain can be attached — the documented layout note
 * the issue asks for. It stays thin, like a controller: validate, mutate
 * `socket.data`, reply. Everything else lives where it already lived.
 */
export class ChatIoAdapter extends IoAdapter {
  /**
   * Kept here because `AbstractWsAdapter` keeps only the HTTP server, not the
   * application — the handshake middleware needs the container to resolve the
   * rate limiter, the session handler and the user repository.
   */
  private readonly nestApp: INestApplication;

  constructor(app: INestApplication) {
    super(app);
    this.nestApp = app;
  }

  override createIOServer(
    port: number,
    options?: ServerOptions,
  ): AuthenticatedServer {
    // socket.io's `createIOServer` is typed `any` upstream — the one
    // untyped third-party boundary this file crosses, asserted to the
    // concrete Server type it actually returns.
    const server = super.createIOServer(port, options) as AuthenticatedServer;

    const config = this.nestApp.get(ConfigService<EnvironmentVariables, true>, {
      strict: false,
    });
    const rateLimiter = this.nestApp.get(RateLimiterService, { strict: false });
    const sessions = this.nestApp.get(SessionMiddleware, { strict: false });
    const users = this.nestApp.get(UserRepository, { strict: false });
    const hops = config.get('TRUSTED_PROXY_HOPS', { infer: true });

    // Rate limit before session resolution, exactly as the issue sequences
    // them: an unauthenticated flood must not cost a Redis session lookup
    // per attempt.
    server.use((socket, next) => {
      void this.rateLimitAttempt(socket, next, rateLimiter, hops);
    });
    server.use((socket, next) => {
      void this.resolveSession(socket, next, sessions, users);
    });

    return server;
  }

  private async rateLimitAttempt(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void,
    rateLimiter: RateLimiterService,
    hops: number,
  ): Promise<void> {
    try {
      const decision = await rateLimiter.consume('ws-connect', {
        ip: resolveClientIp(socket.request, hops),
      });

      if (decision.allowed) {
        next();
        return;
      }

      next(
        new ConnectError('Too many connection attempts', {
          retryAfter: decision.retryAfterMs,
        }),
      );
    } catch (error) {
      // A limiter outage must not open the door — refuse and let the client
      // retry, the same fail-closed stance the REST guard takes.
      this.logger.error(`ws-connect limiter failed: ${String(error)}`);
      next(new ConnectError('Connection refused', { retryAfter: 1000 }));
    }
  }

  private async resolveSession(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void,
    sessions: SessionMiddleware,
    users: UserRepository,
  ): Promise<void> {
    try {
      const userId = await sessions.handshakeUserId(socket.request);
      const user = await resolveSessionUser(users, userId);

      // Identity comes from the handshake and only from the handshake.
      socket.data.user = user;
      next();
    } catch (error) {
      // `resolveSessionUser`'s UnauthorizedError message says which of the
      // three checks rejected; socket.io delivers it as `connect_error`.
      next(error instanceof Error ? error : new Error('Handshake failed'));
    }
  }
}
