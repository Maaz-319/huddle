import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { SnowflakeService } from '../../common/snowflake.service';
import { Server as ServerRow } from '../../generated/prisma/client';
import {
  CreateServerInput,
  OwnerMembership,
  Server,
  ServerRepository,
} from '../server-repository.interface';

/**
 * Postgres-backed `ServerRepository`, via Prisma.
 *
 * `createWithOwner` is the first `$transaction` in the codebase: it writes
 * both the `Server` and its owner `Membership` row, so a crash between the
 * two never leaves a server ownerless. This lives here rather than being
 * sequenced from `AdministrationService` because only an adapter may touch
 * `PrismaService` (AGENTS.md section 2) — a service coordinating two ports
 * with two separate calls could not make the pair atomic.
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
  ): Promise<{ server: Server; membership: OwnerMembership }> {
    const [serverRow, membershipRow] = await this.prisma.$transaction(
      async (tx) => {
        const server = await tx.server.create({
          data: { id: this.snowflakes.generate(), ...input },
        });

        const membership = await tx.membership.create({
          data: { serverId: server.id, userId: ownerId, role: 'owner' },
        });

        return [server, membership] as const;
      },
    );

    return {
      server: toServer(serverRow),
      membership: {
        serverId: membershipRow.serverId,
        userId: membershipRow.userId,
        role: 'owner',
        joinedAt: membershipRow.joinedAt,
      },
    };
  }

  async findById(id: bigint): Promise<Server | null> {
    const row = await this.prisma.server.findUnique({ where: { id } });

    return row === null ? null : toServer(row);
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
