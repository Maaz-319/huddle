import { IsString, Length } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { SendMessageDto } from './send-message.dto';
import { AckFailure, IDEMPOTENCY_KEY_MAX, parseFrame } from './socket-frame';

/**
 * The client → server `message_edit` frame (#66): which channel, which
 * message, the replacement content, and the nonce this replay dedupes on.
 *
 * **`content` is inherited from `SendMessageDto`**, for the same reason as
 * the send frame — REST's `PATCH` and this frame must agree on what a valid
 * message is, and #62 wrote that validator once.
 */
export class MessageEditFrameDto extends SendMessageDto {
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
 * Success: the client swaps its pending edit for the real thing — the id it
 * already knew, plus the stamp that renders the "(edited)" marker. Nullable
 * for the same reason `MessageResponse.editedAt` is, so every event a client
 * sees tells one consistent story about the field.
 */
export interface EditAckSuccess {
  idempotencyKey: string;
  messageId: string;
  editedAt: string | null;
}

/** The direct reply to the sender, exactly as `message_send` acks. */
export type EditAck = EditAckSuccess | AckFailure;

/** Validates a raw `message_edit` payload — see `parseFrame` for the why. */
export function parseMessageEditFrame(
  raw: unknown,
): Promise<MessageEditFrameDto> {
  return parseFrame(MessageEditFrameDto, raw);
}
