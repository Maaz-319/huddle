/**
 * A channel, as the rest of the application sees one.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2).
 * The adapter maps its row onto this shape.
 */
export interface Channel {
  id: bigint;
  serverId: bigint;
  name: string;
  isPrivate: boolean;
  createdAt: Date;
}

/** The fields needed to provision a new channel. */
export interface CreateChannelInput {
  serverId: bigint;
  name: string;
  isPrivate: boolean;
}

/** A partial update to an existing channel — every field optional. */
export interface UpdateChannelInput {
  name?: string;
  isPrivate?: boolean;
}

/**
 * Persistence for channel records.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 */
export abstract class ChannelRepository {
  /**
   * Provisions a channel in a server. Mints the Snowflake id itself, so a
   * caller cannot supply one.
   *
   * Throws `ConflictError` when the server already holds a channel of that
   * name — `UNIQUE (serverId, name)`, data-model.md section 4.4. The
   * uniqueness is scoped to the server, so the same name in a different
   * server is not a conflict.
   *
   * Creating a private channel deliberately seats *nobody*: no
   * `ChannelMember` row is written here. Who is in a private channel is
   * #53's route to decide, and an implicit creator row would be a grant this
   * port could not later explain. The creator reaches the channel through
   * their server role, and the owner always can (PRD section 5).
   */
  abstract create(input: CreateChannelInput): Promise<Channel>;

  /** The channel with this id, or `null`. */
  abstract findById(id: bigint): Promise<Channel | null>;

  /**
   * Every channel in a server, private ones included. Filtering by what the
   * caller may see is the caller's job, not this port's — see
   * `AdministrationService.listChannels`.
   */
  abstract findByServerId(serverId: bigint): Promise<Channel[]>;

  /**
   * Applies a partial update. Throws `NotFoundError` if the id doesn't exist.
   *
   * No route calls this yet: it lands with the rename and visibility-toggle
   * routes in #52. It is defined here so the port is the whole of the channel
   * lifecycle rather than growing a method per ticket — the same reasoning
   * `rate-limit-policies.ts` records for `ws-connect`.
   */
  abstract update(id: bigint, patch: UpdateChannelInput): Promise<Channel>;

  /**
   * Hard-deletes the channel. Throws `NotFoundError` if the id doesn't exist.
   * `Message`, `ChannelMember` and `ChannelOverride` rows cascade off this at
   * the schema level (data-model.md section 7) — no app-level cleanup here.
   *
   * Like `update`, no route calls this until #52.
   */
  abstract delete(id: bigint): Promise<void>;
}
