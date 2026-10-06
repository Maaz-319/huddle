import { FakeUserRepository } from '../../test/fakes/fake-user-repository';
import { UnauthorizedError } from '../common/errors';
import { resolveSessionUser } from './resolve-session-user';

/**
 * The three rejections REST and the WebSocket handshake both depend on.
 * `session-auth.guard.spec.ts` exercises this through the guard; here it is
 * on its own, because #64's handshake middleware calls it directly and a
 * guard-only test would not prove the function itself holds.
 */
describe('resolveSessionUser', () => {
  let users: FakeUserRepository;

  beforeEach(() => {
    users = new FakeUserRepository();
  });

  it('rejects a session that names no user id', async () => {
    await expect(resolveSessionUser(users, undefined)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a session naming a user that does not exist', async () => {
    await expect(
      resolveSessionUser(users, '999000000000000001'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a session naming a user whose account was deleted', async () => {
    const created = await users.create({
      githubId: 'gh-deleted',
      username: 'deleted-user',
      avatarUrl: 'https://example.com/avatar.png',
      email: 'deleted-user@example.com',
    });
    await users.markDeleted(created.id);

    await expect(
      resolveSessionUser(users, created.id.toString()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns the user for a live session', async () => {
    const created = await users.create({
      githubId: 'gh-live',
      username: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
      email: 'octocat@example.com',
    });

    await expect(
      resolveSessionUser(users, created.id.toString()),
    ).resolves.toEqual(created);
  });
});
