import { Module } from '@nestjs/common';
import { RedisRateLimitStore } from './adapters/redis-rate-limit-store.adapter';
import { RateLimitStore } from './rate-limit-store.interface';

/**
 * Rate limiting. This ticket delivers only the primitive: the `RateLimitStore`
 * port and its Redis token-bucket adapter, which is the one piece of bucket
 * maths in the codebase.
 *
 * Everything that decides *what* to limit sits above it and lands later — the
 * named budgets and dimension keys, then the REST guard and its 429 contract,
 * and in Phase 8 the WS gateway checks. All of them call `consume` and none of
 * them reimplement it.
 *
 * The port is exported because those consumers live outside this module's
 * providers today; nothing else about the binding is special. Swapping Redis
 * for another store is a new adapter class and a changed `useClass`.
 */
@Module({
  providers: [{ provide: RateLimitStore, useClass: RedisRateLimitStore }],
  exports: [RateLimitStore],
})
export class RateLimiterModule {}
