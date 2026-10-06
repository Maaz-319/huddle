import { UnauthorizedError } from '../common/errors';
import { User, UserRepository } from './user-repository.interface';

/**
 * The three checks that define "logged in" in Huddle, in one place:
 *
 * 1. a session exists (it names a user id),
 * 2. that user still exists,
 * 3. that user's account has not been deleted (`deletedAt`).
 *
 * Called from both transports — `SessionAuthGuard` on REST routes and the
 * socket.io handshake middleware in the Chat gateway (Phase 8) — so the two
 * can never drift apart on who counts as a caller. A fourth check living in
 * only one of them is exactly the bug this function exists to make
 * unrepresentable: the WebSocket would keep admitting users REST refuses, or
 * vice versa, and account deletion would stop killing live connections.
 *
 * Throws `UnauthorizedError` (401) with the message that says which of the
 * three failed; the socket path converts it to a `connect_error`. The check
 * itself never becomes a boolean, because "which rejection" is worth keeping
 * — REST reports it to the client, and it is what the guard's own tests
 * assert on.
 */
export async function resolveSessionUser(
  users: UserRepository,
  userId: string | undefined,
): Promise<User> {
  if (userId === undefined) {
    throw new UnauthorizedError('Not logged in');
  }

  const user = await users.findById(BigInt(userId));

  if (user === null) {
    throw new UnauthorizedError('Session does not name a real user');
  }

  if (user.deletedAt !== null) {
    throw new UnauthorizedError('This account has been deleted');
  }

  return user;
}
