import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * `AuthGuard('github')`, but tolerant of a denied or failed callback.
 *
 * The stock guard's `handleRequest` throws `UnauthorizedException` when
 * Passport calls back with no user, which would hit the JSON error filter —
 * wrong here, since there is no client yet to read that as JSON
 * (docs/architecture/auth-service.md; `apps/web` is deferred to Phase 12).
 * Returning `undefined` instead lets `AuthController`'s callback handler
 * redirect to `WEB_ORIGIN` with an error indicator, the same as a success.
 *
 * Passport's own convention signals a denial with `user: false`, not
 * `undefined` — and the base guard assigns whatever this returns straight to
 * `req.user` regardless of truthiness. Normalising here means the controller
 * only ever has to check for `undefined`.
 */
@Injectable()
export class GithubAuthGuard extends AuthGuard('github') {
  override handleRequest<TUser>(_err: unknown, user: TUser): TUser | undefined {
    return user || undefined;
  }
}
