/** A server's authority roles, from loosest to tightest capability. */
export type Role = 'owner' | 'moderator' | 'member';

/**
 * A user's membership in a server: the join row plus their role. Declared
 * here rather than re-exported from Prisma, same reasoning as
 * `ServerRepository`'s own doc.
 */
export interface Membership {
  serverId: bigint;
  userId: bigint;
  role: Role;
  joinedAt: Date;
}

/** The fields needed to seat a user in a server. */
export interface CreateMembershipInput {
  serverId: bigint;
  userId: bigint;
  role: Membership['role'];
}

/**
 * Persistence for server membership.
 *
 * An abstract class, never a TypeScript `interface` — same reasoning as
 * `UserRepository`'s own doc, docs/architecture/repo-structure.md section 3.
 *
 * `create` here is not what server creation uses — seating the creator as
 * owner has to happen in the same transaction as the server row itself, so
 * that lives on `ServerRepository.createWithOwner` instead. This method
 * exists for the flows that add a member to an *existing* server, starting
 * with the invite-join flow in a later phase.
 */
export abstract class MembershipRepository {
  /**
   * Seats a user in a server.
   *
   * Throws `ConflictError` if the user already holds a membership in that
   * server.
   */
  abstract create(input: CreateMembershipInput): Promise<Membership>;

  /** Every server this user belongs to. */
  abstract findByUserId(userId: bigint): Promise<Membership[]>;

  /** This user's membership in this server, or `null` if they are not one. */
  abstract findByServerAndUser(
    serverId: bigint,
    userId: bigint,
  ): Promise<Membership | null>;
}
