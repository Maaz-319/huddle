import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';

/**
 * Body for `POST /channels/:channelId/members`.
 *
 * The id arrives as a JSON string and leaves this class as a `bigint`
 * (AGENTS.md section 4) — `@TransformSnowflake()` converts, `@IsSnowflake()`
 * validates what the conversion was given.
 */
export class AddChannelMemberDto {
  @IsSnowflake()
  @TransformSnowflake()
  userId!: bigint;
}
