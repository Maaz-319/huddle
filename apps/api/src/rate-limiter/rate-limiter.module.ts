import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisRateLimitStore } from './adapters/redis-rate-limit-store.adapter';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitStore } from './rate-limit-store.interface';
import { RateLimiterService } from './rate-limiter.service';

/**
 * Rate limiting: the `RateLimitStore` port and its Redis token-bucket adapter,
 * which is the one piece of bucket maths in the codebase, and above it the
 * named budgets, the dimension keys, and `RateLimiterService` composing them.
 *
 * What decides *where* a limit is enforced still sits above this and lands
 * later — the REST guard and its 429 contract, and in Phase 8 the WS gateway
 * checks. Both call `RateLimiterService.consume` and neither reimplements any
 * of it.
 *
 * The port and the service are exported: Phase 8's chat gateway lives outside
 * this module's providers. Nothing else about the binding is special —
 * swapping Redis for another store is a new adapter class and a changed
 * `useClass`.
 *
 * `RateLimitGuard` is registered here as `APP_GUARD` — the same pattern
 * `CommonModule` uses for `APP_PIPE`/`APP_FILTER` — rather than in `main.ts`,
 * so it is equally active in tests that build the app from `AppModule`. This
 * module is already imported directly by `AppModule`, so no `@Global()` is
 * needed for the guard to apply everywhere.
 */
@Module({
  providers: [
    { provide: RateLimitStore, useClass: RedisRateLimitStore },
    RateLimiterService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RateLimitStore, RateLimiterService],
})
export class RateLimiterModule {}
