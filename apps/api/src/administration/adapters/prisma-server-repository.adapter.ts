import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { SnowflakeService } from '../../common/snowflake.service';
import { Server as ServerRow } from '../../generated/prisma/client';
import { Invite } from '../invite-repository.interface';
import {
  CreateServerInput,
  OwnerMembership,
  Server,
  ServerRepository,
  UpdateServerInput,
} from '../server-repository.interface';
import { hasPrismaCode, RECORD_NOT_FOUND, withCodeRetry } from './prisma-codes';
import { toInvite } from './prisma-invite-repository.adapter';

/**
 * Postgres-backed `ServerRepository`, via Prisma.
 *
 * `createWithOwner` is the first `$transaction` in the codebase: it writes the
 * `Server`, its owner `Membership`, and its `Invite` together, so a crash
 * partway never leaves a server ownerless or without a shareable code. This
 * lives here rather than being sequenced from `AdministrationService` because
 * only an adapter may touch `PrismaService` (AGENTS.md section 2) — a service
 * coordinating three ports with three separate calls could not make them
 * atomic.
 */
@Injectable()
export class PrismaServerRepository extends ServerRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflakes: SnowflakeService,
  ) {
    super();
  }

  async create(input: CreateServerInput): Promise<Server> {
    const row = await this.prisma.server.create({
      data: { id: this.snowflakes.generate(), ...input },
    });

    return toServer(row);
  }

  async createWithOwner(
    input: CreateServerInput,
    ownerId: bigint,
  ): Promise<{ server: Server; membership: OwnerMembership; invite: Invite }> {
    // The retry wraps the whole transaction, not just the invite insert: a
    // unique-code collision aborts the transaction it happened in, so the
    // retry has to start a new one. See `withCodeRetry`'s own doc.
    const [serverRow, membershipRow, inviteRow] = await withCodeRetry((code) =>
      this.prisma.$transaction(async (tx) => {
        const server = await tx.server.create({
          data: { id: this.snowflakes.generate(), ...input },
        });

        const membership = await tx.membership.create({
          data: { serverId: server.id, userId: ownerId, role: 'owner' },
        });

        const invite = await tx.invite.create({
          data: { id: this.snowflakes.generate(), serverId: server.id, code },
        });

        return [server, membership, invite] as const;
      }),
    );

    return {
      server: toServer(serverRow),
      membership: {
        serverId: membershipRow.serverId,
        userId: membershipRow.userId,
        role: 'owner',
        joinedAt: membershipRow.joinedAt,
      },
      invite: toInvite(inviteRow),
    };
  }

  async findById(id: bigint): Promise<Server | null> {
    const row = await this.prisma.server.findUnique({ where: { id } });

    return row === null ? null : toServer(row);
  }

  async update(id: bigint, patch: UpdateServerInput): Promise<Server> {
    try {
      const row = await this.prisma.server.update({
        where: { id },
        data: patch,
      });

      return toServer(row);
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('Server not found', { id: id.toString() });
      }

      throw error;
    }
  }

  async delete(id: bigint): Promise<void> {
    try {
      await this.prisma.server.delete({ where: { id } });
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('Server not found', { id: id.toString() });
      }

      throw error;
    }
  }
}

/**
 * A database row, as the port's `Server`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
function toServer(row: ServerRow): Server {
  return {
    id: row.id,
    name: row.name,
    iconUrl: row.iconUrl,
    channelCreationPolicy: row.channelCreationPolicy,
    memberInviteToggle: row.memberInviteToggle,
    createdAt: row.createdAt,
  };
}
