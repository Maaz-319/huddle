import { Injectable } from '@nestjs/common';
import { ChannelOverride as ChannelOverrideRow } from '../../generated/prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  Capability,
  ChannelOverride,
  ChannelOverrideRepository,
  OverrideRole,
} from '../channel-override-repository.interface';

/**
 * Postgres-backed `ChannelOverrideRepository`, via Prisma.
 *
 * `revoke` is an `upsert` with an empty `update` and `restore` is a
 * `deleteMany`, so both are idempotent in one statement — there is nothing to
 * read first and no `P2025` to catch. With no value column on the table there
 * is also nothing an update could change: the row either exists or it does
 * not, and that is the entire state.
 */
@Injectable()
export class PrismaChannelOverrideRepository extends ChannelOverrideRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByChannelId(channelId: bigint): Promise<ChannelOverride[]> {
    const rows = await this.prisma.channelOverride.findMany({
      where: { channelId },
    });

    return rows.map(toChannelOverride);
  }

  async findByChannelIds(channelIds: bigint[]): Promise<ChannelOverride[]> {
    if (channelIds.length === 0) return [];

    const rows = await this.prisma.channelOverride.findMany({
      where: { channelId: { in: channelIds } },
    });

    return rows.map(toChannelOverride);
  }

  async revoke(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void> {
    await this.prisma.channelOverride.upsert({
      where: {
        channelId_role_capability: { channelId, role, capability },
      },
      create: { channelId, role, capability },
      update: {},
    });
  }

  async restore(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void> {
    await this.prisma.channelOverride.deleteMany({
      where: { channelId, role, capability },
    });
  }
}

/**
 * A database row, as the port's `ChannelOverride`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
function toChannelOverride(row: ChannelOverrideRow): ChannelOverride {
  return {
    channelId: row.channelId,
    role: row.role,
    capability: row.capability,
  };
}
