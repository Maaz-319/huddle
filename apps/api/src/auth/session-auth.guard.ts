import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { resolveSessionUser } from './resolve-session-user';
import { UserRepository } from './user-repository.interface';

/**
 * Applied per-route with `@UseGuards(SessionAuthGuard)`, never globally —
 * `GET /health` and the two OAuth routes from #31 must stay reachable
 * without a session, and Phase 4 onward only decorates the specific routes
 * that need a caller.
 *
 * Resolves `req.session.userId` to a real `User` and attaches it to the
 * request as `req.user` (the same field Passport already populates during
 * the OAuth callback, via the `Express.User` augmentation in
 * `session.d.ts`), so `@CurrentUser()` and everything downstream has one
 * place to read the caller from regardless of how they got there.
 *
 * The resolution itself lives in `resolveSessionUser`, shared with the
 * socket.io handshake middleware (#64) so REST and the WebSocket agree on
 * who is logged in. It rejects with `UnauthorizedError` (401) whenever the
 * caller cannot be resolved: no session, a session naming a user that no
 * longer exists, or a user whose `deletedAt` is set. That last case is how
 * account deletion invalidates every other live session for the user (#33) —
 * there is no session index to walk, this guard just refuses to resolve a
 * deleted user the next time any of their sessions is used.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly users: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    request.user = await resolveSessionUser(this.users, request.session.userId);

    return true;
  }
}
