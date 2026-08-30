/**
 * A server's invite, as the rest of the application sees one.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2).
 * The adapter maps its row onto this shape.
 */
export interface Invite {
  id: bigint;
  serverId: bigint;
  code: string;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Persistence for invite codes.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 *
 * There is no `create` here, deliberately. An invite is born with its server,
 * inside `ServerRepository.createWithOwner`'s transaction, so that a server
 * can never exist without a shareable code — the same reasoning that puts the
 * owner `Membership` there. One row per server, updated in place forever after
 * (docs/architecture/administration-service.md section 5).
 */
export abstract class InviteRepository {
  /** This server's invite, or `null` if it has none. */
  abstract findByServerId(serverId: bigint): Promise<Invite | null>;

  /** The invite carrying this code, or `null`. Revoked invites are still found. */
  abstract findByCode(code: string): Promise<Invite | null>;

  /**
   * Mints a new code into the server's existing invite row — "same slot, new
   * code" — clearing `revokedAt` and refreshing `createdAt`. The old code stops
   * working immediately (PRD FR-8), and regenerating is therefore also how a
   * revoked invite is brought back to life; there is no separate un-revoke.
   *
   * The implementation mints the code itself, so a caller cannot supply one.
   *
   * Throws `NotFoundError` if the server has no invite row.
   */
  abstract regenerate(serverId: bigint): Promise<Invite>;

  /**
   * Marks the invite revoked, leaving `code` in place so a later read can tell
   * a client the link is dead rather than missing.
   *
   * Idempotent: revoking an already-revoked invite leaves the original
   * `revokedAt` where it is rather than sliding it forward.
   *
   * Throws `NotFoundError` if the server has no invite row.
   */
  abstract revoke(serverId: bigint): Promise<Invite>;
}
