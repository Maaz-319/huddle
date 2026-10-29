import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { parseFrame } from './socket-frame';
export type { TypingAck, TypingBroadcast } from '@huddle/contracts';

/**
 * The client → server `typing` frame (chat-service.md section 7): one
 * channel, nothing else. No idempotency key — there is no mutation to
 * dedupe, only a window to open — and no content: nothing about what is
 * being composed ever crosses the wire, which is the whole privacy point of
 * a typing indicator (FR-21).
 *
 * There is deliberately **no `stopped_typing` frame in either direction**.
 * The indicator auto-clears client-side after ~5–10 seconds of no new
 * event, and a closed tab or dropped connection could never send a stop
 * frame anyway — relying on one would leave indicators stuck on every
 * unclean disconnect. Nobody should add one later.
 */
export class TypingFrameDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;
}

/**
 * The server → client `typing` payload, broadcast to the channel's room
 * **excluding the sender**. `userId` is the authenticated caller's, as a
 * Snowflake string — identity never comes from the frame (chat-service.md
 * section 7).
 */
/** Validates a raw `typing` payload — see `parseFrame` for the why. */
export function parseTypingFrame(raw: unknown): Promise<TypingFrameDto> {
  return parseFrame(TypingFrameDto, raw);
}
