import { ConflictError } from '../../src/common/errors';
import {
  CreateMembershipInput,
  Membership,
  MembershipRepository,
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
}
