import { IsString, Length } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { AckFailure, IDEMPOTENCY_KEY_MAX, parseFrame } from './socket-frame';

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

/**
 * Success: the client removes the row from its list. Just the id — the
 * sender knew it already, and unlike an edit there is no field of the
 * message to hand back (the deletion itself carries no timestamp a client
 * renders, PRD FR-18/FR-19).
 */
export interface DeleteAckSuccess {
  idempotencyKey: string;
  messageId: string;
}

/** The direct reply to the sender, exactly as `message_send` acks. */
export type DeleteAck = DeleteAckSuccess | AckFailure;

/** Validates a raw `message_delete` payload — see `parseFrame` for the why. */
export function parseMessageDeleteFrame(
  raw: unknown,
): Promise<MessageDeleteFrameDto> {
  return parseFrame(MessageDeleteFrameDto, raw);
}
