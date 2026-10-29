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
   * Creates a channel without an initial private-channel seat. Use
   * `createPrivate` for a moderator-created private channel.
   */
  abstract create(input: CreateChannelInput): Promise<Channel>;

  /**
   * Creates a private channel and seats its moderator creator in the same
   * database transaction. Otherwise the creator would be hidden from the
   * channel immediately after creation and unable to manage its membership.
   */
  abstract createPrivate(
    input: Omit<CreateChannelInput, 'isPrivate'>,
    creatorId: bigint,
  ): Promise<Channel>;

  /** The channel with this id, or `null`. */
  abstract findById(id: bigint): Promise<Channel | null>;

  /**
   * Every channel in a server, private ones included and unfiltered. Deciding
   * what a given caller may see is the caller's job, not this port's — see
   * `AdministrationService.listChannels`, which resolves effective `view`
   * over this result.
   */
  abstract findByServerId(serverId: bigint): Promise<Channel[]>;

  /**
   * Every channel across several servers, in one read. The bulk twin of
   * `findByServerId`, for callers that already hold the whole server set —
   * `AdministrationService.listAccessibleChannels` resolves a user's visible
   * channels across all of their memberships on every WebSocket reconnect
   * (#64), and doing that one server at a time would be a query per server.
   *
   * Like `findByServerId`: private ones included and unfiltered; filtering is
   * the caller's job. An empty `serverIds` returns an empty array rather than
   * asking the database anything.
   */
  abstract findByServerIds(serverIds: bigint[]): Promise<Channel[]>;

  /**
   * Applies a partial update. Throws `NotFoundError` if the id doesn't exist.
   *
   * Called by `PATCH /channels/:channelId`.
   */
  abstract update(id: bigint, patch: UpdateChannelInput): Promise<Channel>;

  /**
   * Hard-deletes the channel. Throws `NotFoundError` if the id doesn't exist.
   * `Message`, `ChannelMember` and `ChannelOverride` rows cascade off this at
   * the schema level (data-model.md section 7) — no app-level cleanup here.
   */
  abstract delete(id: bigint): Promise<void>;
}
