import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';
import { IsSnowflake, TransformSnowflake } from './is-snowflake.decorator';

/** Messages per page, from docs/PRD.md section 3 and chat-service.md section 5. */
export const DEFAULT_PAGE_SIZE = 50;

/** A ceiling, so `?limit=100000` cannot be used to stress the database. */
export const MAX_PAGE_SIZE = 100;

/**
 * Rejects a request that names both `before` and `after`.
 *
 * Declared on the DTO rather than checked in the service so the combination
 * never reaches business logic in the first place — there is no sensible
 * answer to "the page before X and after Y", and a service that had to cope
 * with one would be inventing a precedence rule the client cannot see.
 */
function NotWithBefore(): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'notWithBefore',
      target: object.constructor,
      propertyName: propertyName as string,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const { before } = args.object as CursorPaginationDto;

          return value === undefined || before === undefined;
        },
        defaultMessage(): string {
          return 'before and after are mutually exclusive';
        },
      },
    });
  };
}

/**
 * Cursor pagination for any list that scrolls through Snowflake IDs — channel
 * history in Phase 7 is the first consumer.
 *
 * The cursor is a message ID rather than an offset: Snowflakes sort by time,
 * so "the page before ID X" stays stable while new messages arrive mid-scroll,
 * which offset paging does not.
 *
 * **Both directions return their page oldest → newest**, whichever cursor was
 * sent. That is the order a client renders in, and holding it constant means
 * the client never has to remember which way it asked in order to know how to
 * read the reply. Paging backwards therefore queries `id DESC` — so the index
 * does the work — and reverses the page in memory before returning it.
 */
export class CursorPaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /**
   * Scroll backwards: the page of items immediately *older* than this ID.
   *
   * Absent on the first page, which then means "the newest page".
   *
   * Named `before` rather than the bare `cursor` this class carried before
   * #61: with two directions available, a single name cannot say which one is
   * meant, and a client sending the wrong one would silently get a valid page
   * from the wrong end of the history.
   */
  @IsOptional()
  @IsSnowflake()
  @TransformSnowflake()
  before?: bigint;

  /**
   * Catch up forwards: everything *newer* than this ID, which is the last one
   * the client already holds. Phase 8's reconnect catch-up is what consumes
   * this (chat-service.md section 6).
   *
   * Mutually exclusive with `before`.
   */
  @IsOptional()
  @NotWithBefore()
  @IsSnowflake()
  @TransformSnowflake()
  after?: bigint;
}
