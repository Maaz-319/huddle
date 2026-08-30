import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { Invite as InviteRow } from '../../generated/prisma/client';
import { Invite, InviteRepository } from '../invite-repository.interface';
import { withCodeRetry } from './prisma-codes';

/**
 * Postgres-backed `InviteRepository`, via Prisma.
 *
 * Every write that mints a code goes through `withCodeRetry`, because
 * `Invite.code` carries a unique index and two draws could in principle
 * collide. See that helper for why the retry is bounded.
 */
@Injectable()
export class PrismaInviteRepository extends InviteRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByServerId(serverId: bigint): Promise<Invite | null> {
    const row = await this.prisma.invite.findUnique({ where: { serverId } });

    return row === null ? null : toInvite(row);
  }

  async findByCode(code: string): Promise<Invite | null> {
    const row = await this.prisma.invite.findUnique({ where: { code } });

    return row === null ? null : toInvite(row);
  }

  async regenerate(serverId: bigint): Promise<Invite> {
    await this.requireInvite(serverId);

    const row = await withCodeRetry((code) =>
      this.prisma.invite.update({
        where: { serverId },
        // createdAt is written explicitly: @default(now()) only fires on
        // insert, and regeneration is meant to refresh the link's age.
        data: { code, revokedAt: null, createdAt: new Date() },
      }),
    );

    return toInvite(row);
  }

  async revoke(serverId: bigint): Promise<Invite> {
    const existing = await this.requireInvite(serverId);

    // Already revoked: return the row untouched rather than re-stamping it.
    // Revocation is a fact about when the link died, not about when it was
    // last asked to die.
    if (existing.revokedAt !== null) return toInvite(existing);

    const row = await this.prisma.invite.update({
      where: { serverId },
      data: { revokedAt: new Date() },
    });

    return toInvite(row);
  }

  /** The server's invite row, or the `NotFoundError` both mutations promise. */
  private async requireInvite(serverId: bigint): Promise<InviteRow> {
    const row = await this.prisma.invite.findUnique({ where: { serverId } });

    if (row === null) {
      throw new NotFoundError('Invite not found', {
        serverId: serverId.toString(),
      });
    }

    return row;
  }
}

/**
 * A database row, as the port's `Invite`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
export function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    serverId: row.serverId,
    code: row.code,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
