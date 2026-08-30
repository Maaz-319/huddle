import { generateInviteCode } from '../../src/administration/invite-code';
import {
  Invite,
  InviteRepository,
} from '../../src/administration/invite-repository.interface';
import { NotFoundError } from '../../src/common/errors';
import { FakeAdministrationStore } from './fake-administration-store';

/**
 * In-memory `InviteRepository`, for unit tests of the services that depend on
 * the port.
 *
 * `extends InviteRepository` rather than duck-typing it, same reasoning as
 * `FakeUserRepository`'s own doc: a method added to the port then breaks
 * compilation here.
 *
 * There is no collision retry here, unlike the Prisma adapter. The `Map` is
 * keyed by `serverId` and has no unique index on `code`, so nothing in this
 * implementation can collide — inventing a retry would be testing the fake
 * rather than the contract.
 */
export class FakeInviteRepository extends InviteRepository {
  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  findByServerId(serverId: bigint): Promise<Invite | null> {
    const invite = this.store.invites.get(serverId);

    return Promise.resolve(invite === undefined ? null : { ...invite });
  }

  findByCode(code: string): Promise<Invite | null> {
    for (const invite of this.store.invites.values()) {
      if (invite.code === code) return Promise.resolve({ ...invite });
    }

    return Promise.resolve(null);
  }

  regenerate(serverId: bigint): Promise<Invite> {
    const existing = this.store.invites.get(serverId);

    if (existing === undefined) return Promise.reject(notFound(serverId));

    // Same row id, new code: "same slot, new code". Draw until the code
    // actually differs, so a caller asserting "the link changed" can never be
    // defeated by the astronomically unlikely repeat draw.
    let code = generateInviteCode();
    while (code === existing.code) code = generateInviteCode();

    const regenerated: Invite = {
      ...existing,
      code,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.store.invites.set(serverId, regenerated);

    return Promise.resolve({ ...regenerated });
  }

  revoke(serverId: bigint): Promise<Invite> {
    const existing = this.store.invites.get(serverId);

    if (existing === undefined) return Promise.reject(notFound(serverId));

    // Idempotent: an already-revoked invite keeps its original timestamp.
    if (existing.revokedAt !== null) return Promise.resolve({ ...existing });

    const revoked: Invite = { ...existing, revokedAt: new Date() };
    this.store.invites.set(serverId, revoked);

    return Promise.resolve({ ...revoked });
  }
}

function notFound(serverId: bigint): NotFoundError {
  return new NotFoundError('Invite not found', {
    serverId: serverId.toString(),
  });
}
