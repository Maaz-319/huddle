import { IsString, Length } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { SendMessageDto } from './send-message.dto';
import { IDEMPOTENCY_KEY_MAX, parseFrame } from './socket-frame';
export type { SendAck, SendAckSuccess } from '@huddle/contracts';

/**
 * The client → server `message_send` frame (chat-service.md section 4).
 *
 * **`content` is inherited from `SendMessageDto`, not restated** — the issue
 * requires the socket to validate content with exactly the validator #60
 * wrote: same trim, same empty rejection, same 2048-character cap, measured
 * after trimming. Two copies of those three decorators is how REST and the
 * socket would disagree about what a valid message is.
 *
 * The two frame-specific fields join it: `channelId` as a Snowflake string
 * in both directions (AGENTS.md section 4), and the client-generated
 * idempotency key. The shared pieces — the key bound, the failure ack shape,
 * and `parseFrame` itself — live in `socket-frame.ts`, beside the edit and
 * delete frames that use them too.
 */
export class MessageSendFrameDto extends SendMessageDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;

  @IsString()
  @Length(1, IDEMPOTENCY_KEY_MAX)
  idempotencyKey!: string;
}

/**
 * The direct reply to the sender, separate from the `message_create`
 * broadcast (chat-service.md section 4): it goes through socket.io's emit
 * acknowledgement — literally an "ack" — and so reaches only the client that
 * sent the frame, scoped to that one event.
 */
/**
 * Validates a raw `message_send` payload — the rules themselves are
 * `parseFrame`'s (see `socket-frame.ts` for why validation lives there and
 * not in a `@MessageBody` pipe).
 */
export function parseMessageSendFrame(
  raw: unknown,
): Promise<MessageSendFrameDto> {
  return parseFrame(MessageSendFrameDto, raw);
}
