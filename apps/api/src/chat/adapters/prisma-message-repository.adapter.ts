import { Injectable } from '@nestjs/common';
import {
  FOREIGN_KEY_VIOLATION,
  hasPrismaCode,
} from '../../administration/adapters/prisma-codes';
import { NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { SnowflakeService } from '../../common/snowflake.service';
import { Message as MessageRow } from '../../generated/prisma/client';
import {
  CreateMessageInput,
  Message,
  MessageRepository,
} from '../message-repository.interface';

/**
 * Postgres-backed `MessageRepository`, via Prisma.
 *
 * `Message` carries no unique constraint beyond its primary key, so unlike the
 * administration adapters there is no `P2002` to map. What it does carry is two
 * foreign keys, and `channelId`'s can genuinely lose its parent mid-request —
 * hence the `P2003` mapping, which turns a deleted channel into the same 404 a
 * caller would have got a moment earlier.
 */
@Injectable()
export class PrismaMessageRepository extends MessageRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflakes: SnowflakeService,
  ) {
    super();
  }

  async create(input: CreateMessageInput): Promise<Message> {
    try {
      const row = await this.prisma.message.create({
        data: { id: this.snowflakes.generate(), ...input },
      });

      return toMessage(row);
    } catch (error) {
      if (hasPrismaCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new NotFoundError('Channel not found', {
          channelId: input.channelId.toString(),
        });
      }

      throw error;
    }
  }

  async findById(id: bigint): Promise<Message | null> {
    const row = await this.prisma.message.findUnique({ where: { id } });

    return row === null ? null : toMessage(row);
  }

  async findPageBefore(
    channelId: bigint,
    before: bigint | null,
    limit: number,
  ): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      // `id: { lt: before }` is omitted rather than widened when there is no
      // cursor: the first page is "the newest ones", not "everything before
      // some sentinel".
      where: { channelId, ...(before === null ? {} : { id: { lt: before } }) },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map(toMessage);
  }

  async findPageAfter(
    channelId: bigint,
    after: bigint,
    limit: number,
  ): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: { channelId, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: limit,
    });

    return rows.map(toMessage);
  }
}

/**
 * A database row, as the port's `Message`.
 *
 * Fields are listed rather than spread on purpose — see
 * `prisma-user-repository.adapter.ts`'s own doc for why.
 */
function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    content: row.content,
    editedAt: row.editedAt,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
  };
}
