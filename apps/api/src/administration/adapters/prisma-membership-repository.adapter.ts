import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import {
  Membership as MembershipRow,
  Prisma,
} from '../../generated/prisma/client';
import {
  CreateMembershipInput,
  Membership,
  MembershipRepository,
  Role,
} from '../membership-repository.interface';

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/** Prisma's code for "the record to update/delete was not found". */
const RECORD_NOT_FOUND = 'P2025';

/** Postgres-backed `MembershipRepository`, via Prisma. */
@Injectable()
export class PrismaMembershipRepository extends MembershipRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateMembershipInput): Promise<Membership> {
    try {
      const row = await this.prisma.membership.create({ data: input });

      return toMembership(row);
    } catch (error) {
      if (hasPrismaCode(error, UNIQUE_VIOLATION)) {
        throw new ConflictError('User already belongs to this server', {
          serverId: input.serverId.toString(),
          userId: input.userId.toString(),
        });
      }

      throw error;
    }
  }

  async findByUserId(userId: bigint): Promise<Membership[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId } });

    return rows.map(toMembership);
  }

  async findUserIdsSharingServers(userId: bigint): Promise<bigint[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { serverId: true },
    });
    if (memberships.length === 0) return [userId];

    const peers = await this.prisma.membership.findMany({
      where: { serverId: { in: memberships.map(({ serverId }) => serverId) } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return [...new Set([userId, ...peers.map(({ userId: id }) => id)])];
  }

  async findByServerAndUser(
    serverId: bigint,
    userId: bigint,
  ): Promise<Membership | null> {
    const row = await this.prisma.membership.findUnique({
      where: { serverId_userId: { serverId, userId } },
    });

    return row === null ? null : toMembership(row);
  }

  async updateRole(
    serverId: bigint,
    userId: bigint,
    role: Extract<Role, 'moderator' | 'member'>,
  ): Promise<Membership> {
    try {
      const row = await this.prisma.membership.update({
        where: { serverId_userId: { serverId, userId } },
        data: { role },
      });

      return toMembership(row);
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('User is not a member of this server', {
          serverId: serverId.toString(),
          userId: userId.toString(),
        });
      }

      throw error;
    }
  }

  async transferOwnership(
    serverId: bigint,
    fromUserId: bigint,
    toUserId: bigint,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { serverId_userId: { serverId, userId: toUserId } },
      });

      if (target === null) {
        throw new NotFoundError('User is not a member of this server', {
          serverId: serverId.toString(),
          userId: toUserId.toString(),
        });
      }

      // Demote before promote: the partial unique index only forbids two
      // owners at once, never zero, so this order is never transiently
      // invalid the way promote-then-demote would be.
      await tx.membership.update({
        where: { serverId_userId: { serverId, userId: fromUserId } },
        data: { role: 'member' },
      });

      await tx.membership.update({
        where: { serverId_userId: { serverId, userId: toUserId } },
        data: { role: 'owner' },
      });
    });
  }

  async findByServerId(serverId: bigint): Promise<Membership[]> {
    const rows = await this.prisma.membership.findMany({
      where: { serverId },
      orderBy: { role: 'asc' },
    });

    return rows.map(toMembership);
  }
}

/** Narrows a caught value to a Prisma error carrying a specific code. */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/** A database row, as the port's `Membership`. Fields listed, never spread. */
function toMembership(row: MembershipRow): Membership {
  return {
    serverId: row.serverId,
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt,
  };
}
