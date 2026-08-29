import { ExecutionContext } from '@nestjs/common';
import { FakeUserRepository } from '../../test/fakes/fake-user-repository';
import { UnauthorizedError } from '../common/errors';
import { SessionAuthGuard } from './session-auth.guard';

function fakeContext(request: {
  session: { userId?: string };
  user?: unknown;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  let users: FakeUserRepository;
  let guard: SessionAuthGuard;

  beforeEach(() => {
    users = new FakeUserRepository();
    guard = new SessionAuthGuard(users);
  });

  it('rejects a request with no session userId', async () => {
    const request = { session: {} };

    await expect(
      guard.canActivate(fakeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a session naming a user that does not exist', async () => {
    const request = { session: { userId: '999000000000000001' } };

    await expect(
      guard.canActivate(fakeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a session naming a user whose account was deleted', async () => {
    const created = await users.create({
      githubId: 'gh-2',
      username: 'deleted-user',
      avatarUrl: 'https://example.com/avatar.png',
      email: 'deleted-user@example.com',
    });
    await users.markDeleted(created.id);
    const request = { session: { userId: created.id.toString() } };

    await expect(
      guard.canActivate(fakeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('resolves the user and attaches it to the request on a valid session', async () => {
    const created = await users.create({
      githubId: 'gh-1',
      username: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
      email: 'octocat@example.com',
    });
    const request: { session: { userId?: string }; user?: unknown } = {
      session: { userId: created.id.toString() },
    };

    const result = await guard.canActivate(fakeContext(request));

    expect(result).toBe(true);
    expect(request.user).toEqual(created);
  });
});
