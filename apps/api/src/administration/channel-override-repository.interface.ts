/**
 * The roles a channel override can name.
 *
 * `'owner'` is excluded **at the type level**, not rejected at runtime. The
 * Owner is never overridable — authority is defined at the server level and
 * can never be overridden by a channel (PRD section 5) — so an owner override
 * should be unrepresentable rather than merely invalid. Mirrors the
 * `OverrideRole` enum in `schema.prisma`, which is separate from `Role` for
 * exactly this reason.
 */
export type OverrideRole = 'moderator' | 'member';

/** The four things a role can hold in a channel — administration-service.md section 4. */
export type Capability = 'view' | 'post' | 'delete_others' | 'manage_settings';

/**
 * A revocation. There is no value column, and that is the whole design: the
 * row **existing** is the revocation, and no row means the role inherits the
 * server-wide default (data-model.md section 4.6).
 */
export interface ChannelOverride {
  channelId: bigint;
  role: OverrideRole;
  capability: Capability;
}

/**
 * Persistence for tighten-only channel capability overrides.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 *
 * **The mutators are `revoke`/`restore`, not `create`/`delete`.** Because the
 * table has no value column, `create` and `delete` would name the storage
 * operation while hiding the only thing the table means, at every call site.
 * `restore` is not a grant either: it removes a tightening and hands the role
 * back to whatever the server-wide default says. That is why overrides can
 * only ever tighten — there is no shape here that expresses "give this role
 * something it does not already have".
 */
export abstract class ChannelOverrideRepository {
  /** Every revocation in force on this channel, across both roles. */
  abstract findByChannelId(channelId: bigint): Promise<ChannelOverride[]>;

  /**
   * Every revocation in force across several channels, in one query. The bulk
   * read #54's view-filtered listing needs; an empty input list makes no
   * query at all.
   */
  abstract findByChannelIds(channelIds: bigint[]): Promise<ChannelOverride[]>;

  /**
   * Revokes a capability from a role in a channel, idempotently. Revoking
   * twice leaves the same single row — the end state, not a second write.
   *
   * Returns `void`: the row carries no timestamp and no surrogate id, so
   * anything returned would be exactly what the caller passed in.
   */
  abstract revoke(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void>;

  /**
   * Removes a revocation, handing the role back to the server-wide default.
   * Idempotent: restoring something that was never revoked is a no-op, not a
   * `NotFoundError`.
   */
  abstract restore(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void>;
}
