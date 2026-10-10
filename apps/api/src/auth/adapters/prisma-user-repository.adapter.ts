import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { SnowflakeService } from '../../common/snowflake.service';
import { Prisma, User as UserRow } from '../../generated/prisma/client';
import {
  ProfileSync,
  User,
  UserProfile,
  UserRepository,
} from '../user-repository.interface';

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/** Prisma's code for "the record to update was not found". */
const RECORD_NOT_FOUND = 'P2025';

/**
 * Postgres-backed `UserRepository`, via Prisma.
 *
 * This is the reference adapter every later repository is copied from. Three
 * things make it one, and all three are the point:
 *
 *   - it lives under `adapters/`, the only place `PrismaService` may be
 *     injected (AGENTS.md section 2);
 *   - it maps rows onto the port's own `User`, so no Prisma type escapes;
 *   - it translates Prisma's error codes into our `DomainError`s, so a caller
 *     never has to know what `P2002` means.
 */
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflakes: SnowflakeService,
  ) {
    super();
  }

  async findById(id: bigint): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });

    return row === null ? null : toUser(row);
  }

  async findByGithubId(githubId: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { githubId } });

    return row === null ? null : toUser(row);
  }

  async create(profile: UserProfile): Promise<User> {
    try {
      const row = await this.prisma.user.create({
        data: { id: this.snowflakes.generate(), ...profile },
      });

      return toUser(row);
    } catch (error) {
      if (hasPrismaCode(error, UNIQUE_VIOLATION)) {
        throw new ConflictError('That GitHub account already has a user', {
          githubId: profile.githubId,
        });
      }

      throw error;
    }
  }

  async updateProfile(id: bigint, profile: ProfileSync): Promise<User> {
    try {
      const row = await this.prisma.user.update({
        where: { id },
        // Spread rather than listed field by field so that widening
        // ProfileSync in the port cannot silently stop syncing here.
        data: { ...profile },
      });

      return toUser(row);
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('User not found', { id: id.toString() });
      }

      throw error;
    }
  }

  async updateBio(id: bigint, bio: string | null): Promise<User> {
    try {
      const row = await this.prisma.user.update({
        where: { id },
        data: { bio },
      });

      return toUser(row);
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('User not found', { id: id.toString() });
      }

      throw error;
    }
  }

  async markDeleted(id: bigint): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    } catch (error) {
      if (hasPrismaCode(error, RECORD_NOT_FOUND)) {
        throw new NotFoundError('User not found', { id: id.toString() });
      }

      throw error;
    }
  }

  async findByIds(ids: bigint[]): Promise<User[]> {
    if (ids.length === 0) return [];

    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
    });

    // Maintain the order of the requested IDs
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => rowMap.get(id))
      .filter((user): user is UserRow => user !== undefined)
      .map(toUser);
  }
}

/**
 * Narrows a caught value to a Prisma error carrying a specific code.
 *
 * `catch` gives `unknown`, and the banned alternative would be casting it.
 */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/**
 * A database row, as the port's `User`.
 *
 * Fields are listed rather than spread on purpose: a column added to the schema
 * without a thought about what callers should see shows up as a failing type
 * here instead of leaking out of the port.
 */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.githubId,
    username: row.username,
    avatarUrl: row.avatarUrl,
    email: row.email,
    bio: row.bio,
    deletedAt: row.deletedAt,
  };
}
