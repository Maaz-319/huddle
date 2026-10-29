import { Invite } from './invite-repository.interface';
import type { ChannelCreationPolicy } from '@huddle/contracts';

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
  channelCreationPolicy: ChannelCreationPolicy;
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

/** A partial update to an existing server — every field optional. */
export interface UpdateServerInput {
  name?: string;
  iconUrl?: string | null;
  channelCreationPolicy?: Server['channelCreationPolicy'];
  memberInviteToggle?: boolean;
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
 */
export abstract class ServerRepository {
  /** Provisions a server with no members. Mints the Snowflake id. */
  abstract create(input: CreateServerInput): Promise<Server>;

  /**
   * Provisions a server, seats `ownerId` as its owner `Membership`, and mints
   * the server's `Invite`, in one transaction. Two sequential writes could
   * leave a server with no owner — or with no shareable code — if the process
   * died between them; this is the method that guarantees neither happens, the
   * same way the database's own partial unique index guarantees a server never
   * ends up with two owners.
   *
   * This is the only place an invite is born. `create` above deliberately does
   * not mint one: it seats nobody, so it models a server that does not yet
   * exist as far as any user-facing flow is concerned.
   */
  abstract createWithOwner(
    input: CreateServerInput,
    ownerId: bigint,
  ): Promise<{ server: Server; membership: OwnerMembership; invite: Invite }>;

  /** The server with this id, or `null`. */
  abstract findById(id: bigint): Promise<Server | null>;

  /** Applies a partial update. Throws `NotFoundError` if the id doesn't exist. */
  abstract update(id: bigint, patch: UpdateServerInput): Promise<Server>;

  /**
   * Hard-deletes the server. Throws `NotFoundError` if the id doesn't exist.
   * `Membership`, `Channel`, and `Invite` rows cascade off this at the schema
   * level (data-model.md section 7) — no app-level cleanup needed here.
   */
  abstract delete(id: bigint): Promise<void>;
}
