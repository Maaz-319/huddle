import { Module } from '@nestjs/common';
import { RedisRateLimitStore } from './adapters/redis-rate-limit-store.adapter';
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
 * Both the port and the service are exported: the guard and Phase 8's chat
 * gateway live outside this module's providers. Nothing else about the binding
 * is special — swapping Redis for another store is a new adapter class and a
 * changed `useClass`.
 */
@Module({
  providers: [
    { provide: RateLimitStore, useClass: RedisRateLimitStore },
    RateLimiterService,
  ],
  exports: [RateLimitStore, RateLimiterService],
})
export class RateLimiterModule {}
