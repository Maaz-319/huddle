import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimitedError } from '../common/errors';
import { isSnowflakeString } from '../common/snowflake.service';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';
import {
  RATE_LIMIT_POLICIES,
  RateLimitPolicyName,
} from './rate-limit-policies';
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

    // Read straight off the session, not `req.user` — `RateLimitGuard` is a
    // global `APP_GUARD` and therefore always runs before any route-scoped
    // guard like `SessionAuthGuard`, so `req.user` is never populated yet at
    // this point. `express-session` middleware, unlike a guard, always runs
    // ahead of every guard, so the session itself is reliably present here on
    // any route the session middleware covers (all of them, `AuthModule`
    // section 3).
    const rawUserId = request.session.userId;

    const decision = await this.rateLimiter.consume(policy, {
      ip: request.ip ?? '',
      userId: rawUserId === undefined ? undefined : BigInt(rawUserId),
      channelId: this.channelIdFor(policy, request),
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

  /**
   * The channel a per-channel policy acts on, read off the route.
   *
   * `POST /channels/:channelId/messages` is the first REST route to carry a
   * channel-dimensioned policy (`message-send`), so without this
   * `buildRateLimitKey` would throw on every send. Only channel-dimensioned
   * policies pay for the lookup; everything else gets `undefined` and keys on
   * user or IP as before.
   *
   * Guards run *before* pipes, so `:channelId` is still the raw string here
   * and `ParseSnowflakePipe` has not touched it — the same situation
   * `RequireCapabilityGuard` handles, and it is validated the same way.
   *
   * A malformed id is rejected here with a 400, exactly as
   * `RequireCapabilityGuard` rejects one. It is tempting to shrug it off as
   * "not this guard's job" and let the pipe produce the 400 a moment later,
   * but the two paths available for doing that are both worse: returning
   * `undefined` sends a channel-dimensioned policy into `buildRateLimitKey`
   * with no channel, which throws and renders as a 500; and skipping the
   * limit entirely leaves `/channels/anything/messages` as an unmetered
   * route. `/channels/abc/messages` matches this route pattern, so this is a
   * request anyone can send, not a theoretical one.
   *
   * A channel-dimensioned route with no `:channelId` param at all is a
   * different case — a wiring bug rather than bad input — and is deliberately
   * left to `buildRateLimitKey`'s own throw. Falling back to a shared bucket
   * would quietly merge every channel into one and still return plausible
   * 429s.
   */
  private channelIdFor(
    policy: RateLimitPolicyName,
    request: Request,
  ): bigint | undefined {
    if (RATE_LIMIT_POLICIES[policy].dimension !== 'channel') return undefined;

    const rawChannelId = request.params.channelId;

    if (rawChannelId === undefined) return undefined;

    // `typeof`, not just an undefined check: Express types a route param as
    // `string | string[]`, and `RequireCapabilityGuard` narrows it the same
    // way for the same reason.
    if (typeof rawChannelId !== 'string' || !isSnowflakeString(rawChannelId)) {
      throw new BadRequestException('Expected a Snowflake ID');
    }

    return BigInt(rawChannelId);
  }
}
