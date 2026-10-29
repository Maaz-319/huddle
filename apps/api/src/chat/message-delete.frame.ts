import { IsString, Length } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { IDEMPOTENCY_KEY_MAX, parseFrame } from './socket-frame';
export type { DeleteAck, DeleteAckSuccess } from '@huddle/contracts';

/**
 * The client → server `message_delete` frame (#66): which channel, which
 * message, and the nonce this replay dedupes on. No content field — there is
 * nothing to write, only a row to take away.
 */
export class MessageDeleteFrameDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;

  @IsSnowflake()
  @TransformSnowflake()
  messageId!: bigint;

  @IsString()
  @Length(1, IDEMPOTENCY_KEY_MAX)
  idempotencyKey!: string;
}

/** The direct reply to the sender, exactly as `message_send` acks. */

/** Validates a raw `message_delete` payload — see `parseFrame` for the why. */
export function parseMessageDeleteFrame(
  raw: unknown,
): Promise<MessageDeleteFrameDto> {
  return parseFrame(MessageDeleteFrameDto, raw);
}
