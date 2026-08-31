import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeChannelMemberRepository } from '../../test/fakes/fake-channel-member-repository';
import { FakeChannelOverrideRepository } from '../../test/fakes/fake-channel-override-repository';
import { FakeChannelRepository } from '../../test/fakes/fake-channel-repository';
import { FakeMembershipRepository } from '../../test/fakes/fake-membership-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import { Role } from '../administration/membership-repository.interface';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors';
import { RequireCapability } from './require-capability.decorator';
import { RequireCapabilityGuard } from './require-capability.guard';

const OWNER_ID = 360000000000000001n;
const MODERATOR_ID = 360000000000000002n;
const MEMBER_ID = 360000000000000003n;
const STRANGER_ID = 360000000000000004n;
const NO_SUCH_CHANNEL_ID = 999000000000000007n;

/** Undecorated: no `@RequireCapability` on the class or the handler. */
class PlainController {
  handler(): void {}
}

@RequireCapability('view')
class ViewController {
  handler(): void {}
}

@RequireCapability('manage_settings')
class ManageController {
  handler(): void {}
}

// Mirrors the shape require-role.guard.spec.ts already uses for this -- the
// guard reads only params and user off the request.
function fakeContext(
  target: object,
  channelId: bigint | string,
  userId: bigint,
): ExecutionContext {
  const handler = (target as Record<string, () => void>).handler;

  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        params: { channelId: channelId.toString() },
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

describe('RequireCapabilityGuard', () => {
  let guard: RequireCapabilityGuard;
  let store: FakeAdministrationStore;
  let servers: FakeServerRepository;
  let memberships: FakeMembershipRepository;
  let channels: FakeChannelRepository;
  let channelMembers: FakeChannelMemberRepository;
  let overrides: FakeChannelOverrideRepository;
  let serverId: bigint;

  beforeEach(async () => {
    store = new FakeAdministrationStore();
    servers = new FakeServerRepository(store);
    memberships = new FakeMembershipRepository(store);
    channels = new FakeChannelRepository(store);
    channelMembers = new FakeChannelMemberRepository(store);
    overrides = new FakeChannelOverrideRepository(store);
    guard = new RequireCapabilityGuard(
      new Reflector(),
      channels,
      memberships,
      channelMembers,
      overrides,
    );

    const server = await servers.create({
      name: 'Huddle HQ',
      iconUrl: null,
      channelCreationPolicy: 'everyone',
      memberInviteToggle: true,
    });
    serverId = server.id;

    for (const [role, userId] of Object.entries(ROLE_IDS)) {
      await memberships.create({ serverId, userId, role: role as Role });
    }
  });

  /** The `DomainError` a context is refused with. Fails loudly if it is allowed. */
  async function refusalFrom(context: ExecutionContext): Promise<DomainError> {
    try {
      await guard.canActivate(context);
    } catch (error) {
      if (error instanceof DomainError) return error;
      throw error;
    }

    throw new Error('Expected the guard to refuse, but it allowed the request');
  }

  async function seedChannel(isPrivate: boolean): Promise<bigint> {
    const channel = await channels.create({
      serverId,
      name: isPrivate ? 'mods' : 'general',
      isPrivate,
    });

    return channel.id;
  }

  describe('the lookups the pure function cannot make', () => {
    it('404s for a channel that does not exist', async () => {
      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), NO_SUCH_CHANNEL_ID, MEMBER_ID),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('404s, not 403s, for someone who is not in the channel’s server', async () => {
      const channelId = await seedChannel(false);

      // A non-member must not learn the channel id exists at all.
      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, STRANGER_ID),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects a channelId that is not a Snowflake', async () => {
      // Guards run before pipes, so ParseSnowflakePipe has not seen this yet.
      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), 'not-a-snowflake', MEMBER_ID),
        ),
      ).rejects.toThrow('Expected a Snowflake ID');
    });

    it('makes no lookup at all on an undecorated route', async () => {
      const channelId = await seedChannel(true);
      const findById = jest.spyOn(channels, 'findById');

      // Coverage is opt-in: a caller who would be hidden from this private
      // channel is waved through, because the guard never looks.
      await expect(
        guard.canActivate(
          fakeContext(new PlainController(), channelId, MEMBER_ID),
        ),
      ).resolves.toBe(true);
      expect(findById).not.toHaveBeenCalled();
    });
  });

  describe('the owner bypass', () => {
    it('lets the owner into a private channel they hold no row in', async () => {
      const channelId = await seedChannel(true);

      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, OWNER_ID),
        ),
      ).resolves.toBe(true);
    });

    it('reads neither the member nor the override table for an owner', async () => {
      const channelId = await seedChannel(true);
      const isMember = jest.spyOn(channelMembers, 'isMember');
      const findOverrides = jest.spyOn(overrides, 'findByChannelId');

      await guard.canActivate(
        fakeContext(new ManageController(), channelId, OWNER_ID),
      );

      // Not an optimisation: PRD section 5 says a channel can never touch an
      // owner's authority, so those tables must not even be consulted.
      expect(isMember).not.toHaveBeenCalled();
      expect(findOverrides).not.toHaveBeenCalled();
    });
  });

  describe('mapping a decision to a status', () => {
    it('allows a member to view a public channel', async () => {
      const channelId = await seedChannel(false);

      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, MEMBER_ID),
        ),
      ).resolves.toBe(true);
    });

    it('404s a private channel for a server member who is not in it', async () => {
      const channelId = await seedChannel(true);

      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, MEMBER_ID),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('gives that 404 a body identical to the unknown-channel 404', async () => {
      const channelId = await seedChannel(true);

      const hidden = await refusalFrom(
        fakeContext(new ViewController(), channelId, MEMBER_ID),
      );
      const missing = await refusalFrom(
        fakeContext(new ViewController(), NO_SUCH_CHANNEL_ID, MEMBER_ID),
      );

      // If the two differed in message or details, the 404 would still be an
      // existence oracle and "fully hidden" would not hold.
      expect(hidden.message).toBe(missing.message);
      expect(Object.keys(hidden.details ?? {})).toEqual(
        Object.keys(missing.details ?? {}),
      );
    });

    it('404s, not 403s, a view revoked by an override', async () => {
      const channelId = await seedChannel(false);
      await overrides.revoke(channelId, 'member', 'view');

      // Deliberately beyond #51's literal step 6 -- see the guard's own doc.
      // Once #54 filters this channel out of the listing, a 403 here would
      // confirm a channel the caller can never see listed.
      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, MEMBER_ID),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('403s a non-view capability the role never holds', async () => {
      const channelId = await seedChannel(false);

      // By now the caller can already see the channel, so there is nothing
      // left to hide and a 403 is the honest answer.
      await expect(
        guard.canActivate(
          fakeContext(new ManageController(), channelId, MEMBER_ID),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('403s a non-view capability revoked from a moderator by an override', async () => {
      const channelId = await seedChannel(false);
      await overrides.revoke(channelId, 'moderator', 'manage_settings');

      await expect(
        guard.canActivate(
          fakeContext(new ManageController(), channelId, MODERATOR_ID),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows a moderator the capabilities no override touched', async () => {
      const channelId = await seedChannel(false);
      await overrides.revoke(channelId, 'moderator', 'post');

      await expect(
        guard.canActivate(
          fakeContext(new ManageController(), channelId, MODERATOR_ID),
        ),
      ).resolves.toBe(true);
    });

    it('allows a member into a private channel they have been seated in', async () => {
      const channelId = await seedChannel(true);
      await channelMembers.add(channelId, MEMBER_ID);

      await expect(
        guard.canActivate(
          fakeContext(new ViewController(), channelId, MEMBER_ID),
        ),
      ).resolves.toBe(true);
    });
  });
});
