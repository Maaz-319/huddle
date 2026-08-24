import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsSnowflake, TransformSnowflake } from './is-snowflake.decorator';

/** Messages per page, from docs/PRD.md section 3 and chat-service.md section 5. */
export const DEFAULT_PAGE_SIZE = 50;

/** A ceiling, so `?limit=100000` cannot be used to stress the database. */
export const MAX_PAGE_SIZE = 100;

/**
 * Cursor pagination for any list that scrolls backwards through Snowflake IDs
 * — channel history in Phase 7 is the first consumer.
 *
 * The cursor is a message ID rather than an offset: Snowflakes sort by time,
 * so "the page before ID X" stays stable while new messages arrive mid-scroll,
 * which offset paging does not.
 */
export class CursorPaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /** Absent on the first page; otherwise the oldest ID already held. */
  @IsOptional()
  @IsSnowflake()
  @TransformSnowflake()
  cursor?: bigint;
}
