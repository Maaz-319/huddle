import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { AckFailure, parseFrame } from './socket-frame';

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
 * What comes back to the sender: **failures only** — refusals ride the
 * ack with the same `AckFailure` shape every other frame sends, and a
 * frame that was accepted or debounced never calls the ack at all. There
 * is nothing the typist's own client needs to hear: it already knows it is
 * typing, and the drop-vs-broadcast distinction is invisible to the person
 * whose window it is (#67's design decision).
 */
export type TypingAck = AckFailure;

/**
 * The server → client `typing` payload, broadcast to the channel's room
 * **excluding the sender**. `userId` is the authenticated caller's, as a
 * Snowflake string — identity never comes from the frame (chat-service.md
 * section 7).
 */
export interface TypingBroadcast {
  channelId: string;
  userId: string;
}

/** Validates a raw `typing` payload — see `parseFrame` for the why. */
export function parseTypingFrame(raw: unknown): Promise<TypingFrameDto> {
  return parseFrame(TypingFrameDto, raw);
}
