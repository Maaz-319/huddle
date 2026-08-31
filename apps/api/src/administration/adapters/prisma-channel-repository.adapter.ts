import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { SnowflakeService } from '../../common/snowflake.service';
import { Channel as ChannelRow } from '../../generated/prisma/client';
import {
  Channel,
  ChannelRepository,
  CreateChannelInput,
  UpdateChannelInput,
} from '../channel-repository.interface';
import {
  hasPrismaCode,
  RECORD_NOT_FOUND,
  UNIQUE_VIOLATION,
} from './prisma-codes';

/**
 * Postgres-backed `ChannelRepository`, via Prisma.
 *
 * The only unique constraint in play is `UNIQUE (serverId, name)`, so every
 * `P2002` out of this adapter means one thing and is mapped to the shared
 * `ConflictError` — which the exception filter renders as a 409. A raw Prisma
 * error escaping here would surface as a 500 instead.
 */
@Injectable()
export class PrismaChannelRepository extends ChannelRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflakes: SnowflakeService,
  ) {
    super();
  }

  async create(input: CreateChannelInput): Promise<Channel> {
    try {
      const row = await this.prisma.channel.create({
        data: { id: this.snowflakes.generate(), ...input },
      });

      return toChannel(row);
    } catch (error) {
      if (hasPrismaCode(error, UNIQUE_VIOLATION)) {
        throw this.duplicateName(input.serverId, input.name);
      }

      throw error;
    }
  }

  async findById(id: bigint): Promise<Channel | null> {
    const row = await this.prisma.channel.findUnique({ where: { id } });

    return row === null ? null : toChannel(row);
  }

  async findByServerId(serverId: bigint): Promise<Channel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { serverId },
      // Snowflakes are sortable by creation order for free (data-model.md
      // section 2), so this is "oldest channel first" without a createdAt sort.
      orderBy: { id: 'asc' },
    });

    return rows.map(toChannel);
  }

  async update(id: bigint, patch: UpdateChannelInput): Promise<Channel> {
    try {
      const row = await this.prisma.channel.update({
        where: { id },
        data: patch,
      });

      return toChannel(row);
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('Channel not found', { id: id.toString() });
      }

      if (hasPrismaCode(error, UNIQUE_VIOLATION)) {
        // The rename collided. serverId is not in the patch, so it has to be
        // read back off the row rather than echoed from the input.
        const existing = await this.prisma.channel.findUnique({
          where: { id },
        });

        throw this.duplicateName(existing?.serverId ?? id, patch.name ?? '');
      }

      throw error;
    }
  }

  async delete(id: bigint): Promise<void> {
    try {
      await this.prisma.channel.delete({ where: { id } });
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('Channel not found', { id: id.toString() });
      }

      throw error;
    }
  }

  private duplicateName(serverId: bigint, name: string): ConflictError {
    return new ConflictError('A channel with this name already exists', {
      serverId: serverId.toString(),
      name,
    });
  }
}

/**
 * A database row, as the port's `Channel`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    isPrivate: row.isPrivate,
    createdAt: row.createdAt,
  };
}
