import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimitedError } from '../common/errors';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';
import { RateLimitPolicyName } from './rate-limit-policies';
import { RateLimiterService } from './rate-limiter.service';

/**
 * Enforces the policy a route carries via `@RateLimit(...)`, in front of every
 * controller in the app.
 *
 * A guard rather than middleware, deliberately: Nest middleware runs before
 * the router resolves a handler, so it cannot read route metadata, and
 * per-route budgets need exactly that
 * (docs/architecture/rate-limiter.md section 5). It rejects before the
 * controller body runs, which is what that section actually requires.
 *
 * Registered application-wide via `APP_GUARD` in `rate-limiter.module.ts`,
 * not in `main.ts` — e2e tests build the app from `AppModule` and never run
 * `main.ts`, so a `main.ts`-only guard would be untested
 * (see `CommonModule`'s own `APP_PIPE`/`APP_FILTER` for the same reasoning).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<
      RateLimitPolicyName | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);

    // Coverage is opt-in: an undecorated route makes no Redis call at all.
    // `GET /health` relies on exactly this to stay unlimited.
    if (policy === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // No session yet (Phase 3) and no REST route is channel-dimensioned today
    // (message-send is WS-only, Phase 8) — the address is all there is to
    // build a context from. See RateLimitContext.userId.
    const decision = await this.rateLimiter.consume(policy, {
      ip: request.ip ?? '',
    });

    response.setHeader('X-RateLimit-Limit', decision.limit);
    response.setHeader('X-RateLimit-Remaining', decision.remaining);
    response.setHeader('X-RateLimit-Reset', decision.resetAt);

    if (!decision.allowed) {
      // Whole seconds, rounded up: a Retry-After of 0 tells a client to retry
      // immediately, the opposite of the intent
      // (docs/architecture/rate-limiter.md section 6).
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));

      throw new RateLimitedError('Rate limit exceeded', retryAfter, {
        policy,
      });
    }

    return true;
  }
}
