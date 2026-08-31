import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import {
  MembershipRepository,
  Role,
} from '../administration/membership-repository.interface';
import {
  Server,
  ServerRepository,
} from '../administration/server-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { RequireChannelCreation } from './require-channel-creation.decorator';
import { RequireChannelCreationGuard } from './require-channel-creation.guard';

const OWNER_ID = 350000000000000001n;
const MODERATOR_ID = 350000000000000002n;
const MEMBER_ID = 350000000000000003n;
const STRANGER_ID = 350000000000000004n;
const NO_SUCH_SERVER_ID = 999000000000000006n;

/** Undecorated: no `@RequireChannelCreation` on the class or the handler. */
class PlainController {
  handler(): void {}
}

@RequireChannelCreation()
class GatedController {
  handler(): void {}
}

// Mirrors the shape require-role.guard.spec.ts already uses for this -- the
// guard reads only params and user off the request, and building a whole
// ExecutionContext would say nothing extra.
function fakeContext(
  target: object,
  serverId: bigint,
  userId: bigint,
): ExecutionContext {
  const handler = (target as Record<string, () => void>).handler;

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

const ROLE_IDS: Record<Role, bigint> = {
  owner: OWNER_ID,
  moderator: MODERATOR_ID,
  member: MEMBER_ID,
};

describe('RequireChannelCreationGuard', () => {
  let guard: RequireChannelCreationGuard;
  let memberships: MembershipRepository;
  let servers: ServerRepository;
  let store: FakeAdministrationStore;

  beforeEach(() => {
    store = new FakeAdministrationStore();
    memberships = new FakeMembershipRepository(store);
    servers = new FakeServerRepository(store);
    guard = new RequireChannelCreationGuard(
      new Reflector(),
      memberships,
      servers,
    );
  });

  /** A server on the given policy, with all three roles already seated. */
  async function seedServer(
    policy: Server['channelCreationPolicy'],
  ): Promise<bigint> {
    const server = await servers.create({
      name: 'Huddle HQ',
      iconUrl: null,
      channelCreationPolicy: policy,
      memberInviteToggle: true,
    });

    for (const [role, userId] of Object.entries(ROLE_IDS)) {
      await memberships.create({
        serverId: server.id,
        userId,
        role: role as Role,
      });
    }

    return server.id;
  }

  describe('the policy matrix', () => {
    // The whole of administration-service.md section 3, as a table a person
    // wrote rather than a rule derived from the guard's own mapping.
    const CASES: [Server['channelCreationPolicy'], Role, boolean][] = [
      ['owner_only', 'owner', true],
      ['owner_only', 'moderator', false],
      ['owner_only', 'member', false],
      ['mods_only', 'owner', true],
      ['mods_only', 'moderator', true],
      ['mods_only', 'member', false],
      ['everyone', 'owner', true],
      ['everyone', 'moderator', true],
      ['everyone', 'member', true],
    ];

    it.each(CASES)(
      'under %s policy, a %s is allowed: %s',
      async (policy, role, allowed) => {
        const serverId = await seedServer(policy);
        const context = fakeContext(
          new GatedController(),
          serverId,
          ROLE_IDS[role],
        );

        if (allowed) {
          await expect(guard.canActivate(context)).resolves.toBe(true);
        } else {
          await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            ForbiddenError,
          );
        }
      },
    );
  });

  it('keeps the owner in under mods_only', async () => {
    // Called out separately because it is the case a naive reading of the
    // policy name gets wrong: an owner is never locked out of their own
    // server by a setting they control.
    const serverId = await seedServer('mods_only');

    await expect(
      guard.canActivate(fakeContext(new GatedController(), serverId, OWNER_ID)),
    ).resolves.toBe(true);
  });

  it('forbids someone who is not a member at all', async () => {
    const serverId = await seedServer('everyone');

    await expect(
      guard.canActivate(
        fakeContext(new GatedController(), serverId, STRANGER_ID),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reports an unknown server as not found, not forbidden', async () => {
    // 404 rather than 403: a nonexistent server has no membership rows for
    // anyone, so a bare "forbidden" would be the wrong answer as well as an
    // unhelpful one.
    await expect(
      guard.canActivate(
        fakeContext(new GatedController(), NO_SUCH_SERVER_ID, OWNER_ID),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a serverId that is not a Snowflake', async () => {
    const gated = new GatedController();
    const handler = gated.handler.bind(gated);
    const context = {
      getHandler: () => handler,
      getClass: () => GatedController,
      switchToHttp: () => ({
        getRequest: () => ({
          params: { serverId: 'not-a-snowflake' },
          user: { id: OWNER_ID },
        }),
      }),
    } as unknown as ExecutionContext;

    // Guards run before pipes, so ParseSnowflakePipe has not seen this yet.
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Expected a Snowflake ID',
    );
  });

  it('makes no lookup at all on an undecorated route', async () => {
    const serverId = await seedServer('owner_only');
    const findById = jest.spyOn(servers, 'findById');
    const findMembership = jest.spyOn(memberships, 'findByServerAndUser');

    // Coverage is opt-in. A member who would be forbidden by the policy is
    // waved through, because the guard never looks.
    await expect(
      guard.canActivate(
        fakeContext(new PlainController(), serverId, MEMBER_ID),
      ),
    ).resolves.toBe(true);
    expect(findById).not.toHaveBeenCalled();
    expect(findMembership).not.toHaveBeenCalled();
  });
});
