import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { EnvironmentVariables } from './env.validation';

/**
 * How many times a lost connection is retried before the client gives up for
 * good. Past this, `retryStrategy` returns null and ioredis stops reconnecting:
 * a Redis that comes back after that needs the process restarted. That is the
 * deliberate trade -- an outage stays visible on /health instead of the app
 * quietly limping along reconnecting forever.
 */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Backoff step and ceiling, in milliseconds, between reconnect attempts. */
const RECONNECT_DELAY_STEP_MS = 200;
const RECONNECT_DELAY_CEILING_MS = 2000;

/**
 * The injectable Redis connection, and the only place it is opened or closed.
 *
 * One client is shared by everything Redis backs: the rate-limiter token
 * buckets, the session store, the presence registry, and message idempotency
 * keys. It extends `Redis` rather than hiding it behind a narrow wrapper --
 * Phase 2 loads a Lua script through this same connection for the atomic
 * token-bucket operation (docs/architecture/rate-limiter.md section 2), which
 * needs the real client surface.
 *
 * The URL is used exactly as configured, never assembled from parts. Redis
 * Cloud requires TLS, so production may be `rediss://` while local is
 * `redis://`, and no scheme is hardcoded anywhere.
 *
 * Boundary rule, from docs/architecture/repo-structure.md section 5: only
 * `adapters/*.adapter.ts` files may inject this. A `*.service.ts` never does --
 * that is what keeps Redis swappable behind the ports.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super(config.get('REDIS_URL', { infer: true }), {
      // A command issued while the connection is down waits for at most two
      // reconnect attempts and is then flushed with an error. That is what
      // stops a Redis outage from hanging the request that triggered it.
      maxRetriesPerRequest: 2,
      // The offline queue stays on, deliberately. ioredis connects
      // asynchronously, so with it off the first command after boot races the
      // socket and fails for no good reason. maxRetriesPerRequest above is
      // what bounds the wait; once the client has given up reconnecting
      // entirely, commands reject immediately anyway.
      enableOfflineQueue: true,
      retryStrategy: (times: number) =>
        times > MAX_RECONNECT_ATTEMPTS
          ? null
          : Math.min(
              times * RECONNECT_DELAY_STEP_MS,
              RECONNECT_DELAY_CEILING_MS,
            ),
    });

    // ioredis emits `error` on every failed reconnect, and an unhandled
    // `error` on an EventEmitter takes the process down with it.
    this.on('error', (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    this.on('ready', () => {
      this.logger.log('Connected to Redis');
    });
  }

  async onModuleDestroy(): Promise<void> {
    // `quit` waits for pending replies, unlike `disconnect`. It rejects if the
    // connection is already gone -- which on shutdown is the desired end state
    // anyway, so it is not worth failing the shutdown over.
    try {
      await this.quit();
    } catch (error) {
      this.logger.warn(
        `Redis did not close cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.disconnect();
    }
  }
}
