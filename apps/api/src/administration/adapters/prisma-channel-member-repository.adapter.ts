import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ChannelMember as ChannelMemberRow } from '../../generated/prisma/client';
import {
  ChannelMember,
  ChannelMemberRepository,
} from '../channel-member-repository.interface';

/**
 * Postgres-backed `ChannelMemberRepository`, via Prisma.
 *
 * Both mutators are written so idempotency is a property of the single
 * statement rather than of a read-then-write: `add` is an `upsert` and
 * `remove` is a `deleteMany`. That is one round trip each, no `P2025` to
 * catch, and no window where two concurrent callers can disagree.
 */
@Injectable()
export class PrismaChannelMemberRepository extends ChannelMemberRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async add(channelId: bigint, userId: bigint): Promise<ChannelMember> {
    // An empty `update` is what makes this return the existing row untouched
    // rather than sliding addedAt forward on a re-add.
    const row = await this.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId },
      update: {},
    });

    return toChannelMember(row);
  }

  async remove(channelId: bigint, userId: bigint): Promise<void> {
    await this.prisma.channelMember.deleteMany({
      where: { channelId, userId },
    });
  }

  async findByChannelId(channelId: bigint): Promise<ChannelMember[]> {
    const rows = await this.prisma.channelMember.findMany({
      where: { channelId },
      orderBy: { userId: 'asc' },
    });

    return rows.map(toChannelMember);
  }

  async findChannelIdsForUser(
    channelIds: bigint[],
    userId: bigint,
  ): Promise<Set<bigint>> {
    if (channelIds.length === 0) return new Set();

    const rows = await this.prisma.channelMember.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true },
    });

    return new Set(rows.map((row) => row.channelId));
  }

  async isMember(channelId: bigint, userId: bigint): Promise<boolean> {
    const row = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { channelId: true },
    });

    return row !== null;
  }
}

/**
 * A database row, as the port's `ChannelMember`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
function toChannelMember(row: ChannelMemberRow): ChannelMember {
  return {
    channelId: row.channelId,
    userId: row.userId,
    addedAt: row.addedAt,
  };
}
