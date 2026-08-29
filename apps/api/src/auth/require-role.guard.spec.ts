import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import { MembershipRepository } from '../administration/membership-repository.interface';
import { ServerRepository } from '../administration/server-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { RequireRole } from './require-role.decorator';
import { RequireRoleGuard } from './require-role.guard';

const OWNER_ID = 300000000000000001n;
const MEMBER_ID = 300000000000000002n;
const STRANGER_ID = 300000000000000003n;
const NO_SUCH_SERVER_ID = 999000000000000001n;

/** Undecorated: no `@RequireRole` on either the class or the handler. */
class PlainController {
  handler(): void {}
}

@RequireRole('owner')
class OwnerOnlyController {
  handler(): void {}
}

function fakeContext(
  target: object,
  handlerName: string,
  serverId: bigint,
  userId: bigint,
): ExecutionContext {
  const handler = (target as Record<string, () => void>)[handlerName];

  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        params: { serverId: serverId.toString() },
        user: { id: userId },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RequireRoleGuard', () => {
  let guard: RequireRoleGuard;
  let memberships: MembershipRepository;
  let servers: ServerRepository;
  let serverId: bigint;

  beforeEach(async () => {
    const store = new FakeAdministrationStore();
    memberships = new FakeMembershipRepository(store);
    servers = new FakeServerRepository(store);

    const server = await servers.create({
      name: 'General Chat',
      iconUrl: null,
      channelCreationPolicy: 'everyone',
      memberInviteToggle: true,
    });
    serverId = server.id;

    await memberships.create({ serverId, userId: OWNER_ID, role: 'owner' });
    await memberships.create({ serverId, userId: MEMBER_ID, role: 'member' });

    guard = new RequireRoleGuard(new Reflector(), memberships, servers);
  });

  it('makes no membership lookup at all on an undecorated route', async () => {
    const spy = jest.spyOn(memberships, 'findByServerAndUser');
    const instance = new PlainController();

    const result = await guard.canActivate(
      fakeContext(instance, 'handler', serverId, STRANGER_ID),
    );

    expect(result).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows a caller holding one of the required roles', async () => {
    const instance = new OwnerOnlyController();

    await expect(
      guard.canActivate(fakeContext(instance, 'handler', serverId, OWNER_ID)),
    ).resolves.toBe(true);
  });

  it('rejects a caller holding a role not in the allow-list', async () => {
    const instance = new OwnerOnlyController();

    await expect(
      guard.canActivate(fakeContext(instance, 'handler', serverId, MEMBER_ID)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a caller with no membership in an existing server', async () => {
    const instance = new OwnerOnlyController();

    await expect(
      guard.canActivate(
        fakeContext(instance, 'handler', serverId, STRANGER_ID),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects with NotFoundError, not ForbiddenError, for a server that does not exist', async () => {
    const instance = new OwnerOnlyController();

    await expect(
      guard.canActivate(
        fakeContext(instance, 'handler', NO_SUCH_SERVER_ID, OWNER_ID),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
