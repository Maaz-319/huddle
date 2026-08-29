import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import {
  Membership as MembershipRow,
  Prisma,
} from '../../generated/prisma/client';
import {
  CreateMembershipInput,
  Membership,
  MembershipRepository,
} from '../membership-repository.interface';

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

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

  async findByServerAndUser(
    serverId: bigint,
    userId: bigint,
  ): Promise<Membership | null> {
    const row = await this.prisma.membership.findUnique({
      where: { serverId_userId: { serverId, userId } },
    });

    return row === null ? null : toMembership(row);
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
