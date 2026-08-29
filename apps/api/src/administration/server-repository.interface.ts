/**
 * A Huddle server, as the rest of the application sees one.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2).
 * The adapter maps its row onto this shape.
 */
export interface Server {
  id: bigint;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: 'owner_only' | 'everyone' | 'mods_only';
  memberInviteToggle: boolean;
  createdAt: Date;
}

/** The fields needed to provision a new server. */
export interface CreateServerInput {
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: Server['channelCreationPolicy'];
  memberInviteToggle: boolean;
}

/** The `Membership` seated as part of `createWithOwner` — see that method's doc. */
export interface OwnerMembership {
  serverId: bigint;
  userId: bigint;
  role: 'owner';
  joinedAt: Date;
}

/**
 * Persistence for server records.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 *
 * Rename, settings changes, and hard delete are deliberately not here yet —
 * they land with #35, matching how `UserRepository` itself grew across #32
 * and #33 rather than being authored all at once.
 */
export abstract class ServerRepository {
  /** Provisions a server with no members. Mints the Snowflake id. */
  abstract create(input: CreateServerInput): Promise<Server>;

  /**
   * Provisions a server and seats `ownerId` as its owner `Membership`, in one
   * transaction. Two sequential writes could leave a server with no owner if
   * the process died between them; this is the method that guarantees that
   * never happens, the same way the database's own partial unique index
   * guarantees a server never ends up with two.
   */
  abstract createWithOwner(
    input: CreateServerInput,
    ownerId: bigint,
  ): Promise<{ server: Server; membership: OwnerMembership }>;

  /** The server with this id, or `null`. */
  abstract findById(id: bigint): Promise<Server | null>;
}
