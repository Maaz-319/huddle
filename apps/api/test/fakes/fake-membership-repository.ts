import { ConflictError, NotFoundError } from '../../src/common/errors';
import {
  CreateMembershipInput,
  Membership,
  MembershipRepository,
  Role,
} from '../../src/administration/membership-repository.interface';
import {
  FakeAdministrationStore,
  membershipKey,
} from './fake-administration-store';

/**
 * In-memory `MembershipRepository`, sharing a `FakeAdministrationStore` with
 * a `FakeServerRepository` so a server the latter creates is visible here —
 * see that store's own doc for why.
 */
export class FakeMembershipRepository extends MembershipRepository {
  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  create(input: CreateMembershipInput): Promise<Membership> {
    const key = membershipKey(input.serverId, input.userId);

    if (this.store.memberships.has(key)) {
      return Promise.reject(
        new ConflictError('User already belongs to this server', {
          serverId: input.serverId.toString(),
          userId: input.userId.toString(),
        }),
      );
    }

    const membership: Membership = { joinedAt: new Date(), ...input };
    this.store.memberships.set(key, membership);

    return Promise.resolve({ ...membership });
  }

  findByUserId(userId: bigint): Promise<Membership[]> {
    const found = [...this.store.memberships.values()].filter(
      (membership) => membership.userId === userId,
    );

    return Promise.resolve(found.map((membership) => ({ ...membership })));
  }

  findByServerAndUser(
    serverId: bigint,
    userId: bigint,
  ): Promise<Membership | null> {
    const membership = this.store.memberships.get(
      membershipKey(serverId, userId),
    );

    return Promise.resolve(membership === undefined ? null : { ...membership });
  }

  updateRole(
    serverId: bigint,
    userId: bigint,
    role: Extract<Role, 'moderator' | 'member'>,
  ): Promise<Membership> {
    const key = membershipKey(serverId, userId);
    const existing = this.store.memberships.get(key);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('User is not a member of this server', {
          serverId: serverId.toString(),
          userId: userId.toString(),
        }),
      );
    }

    const updated: Membership = { ...existing, role };
    this.store.memberships.set(key, updated);

    return Promise.resolve({ ...updated });
  }

  transferOwnership(
    serverId: bigint,
    fromUserId: bigint,
    toUserId: bigint,
  ): Promise<void> {
    const toKey = membershipKey(serverId, toUserId);
    const target = this.store.memberships.get(toKey);

    if (target === undefined) {
      return Promise.reject(
        new NotFoundError('User is not a member of this server', {
          serverId: serverId.toString(),
          userId: toUserId.toString(),
        }),
      );
    }

    const fromKey = membershipKey(serverId, fromUserId);
    const from = this.store.memberships.get(fromKey);

    if (from !== undefined) {
      this.store.memberships.set(fromKey, { ...from, role: 'member' });
    }

    this.store.memberships.set(toKey, { ...target, role: 'owner' });

    return Promise.resolve();
  }

  findByServerId(serverId: bigint): Promise<Membership[]> {
    const found = [...this.store.memberships.values()].filter(
      (membership) => membership.serverId === serverId,
    );

    return Promise.resolve(found.map((membership) => ({ ...membership })));
  }
}
