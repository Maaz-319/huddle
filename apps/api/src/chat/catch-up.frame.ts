import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import type { MessageResponse } from './message-response';
import { AckFailure, parseFrame } from './socket-frame';

/**
 * How many messages one channel hands back in a single catch-up reply (#68).
 *
 * A client offline for a month asking for everything at once is the failure
 * this bounds: past the cap the reply says `truncated: true` for that channel
 * and the client falls back to a fresh history load, rather than silently
 * rendering a partial list with a gap in it. The name matches what the field
 * means to the caller — this was the cap, so this was everything before the
 * truncation point.
 */
export const CATCH_UP_LIMIT = 200;

/**
 * How many channel entries one `catch_up` frame may carry.
 *
 * The frame's whole point is "every channel I hold state for in one shot",
 * so the bound sits far above any real membership — but it is a bound, not
 * infinity: an unbounded array is the mirror of the unbounded per-channel
 * history the message cap above exists to stop, and validation would
 * otherwise happily hand the handler a work set of ten thousand ids.
 */
export const CATCH_UP_MAX_CHANNELS = 200;

/**
 * One channel's worth of catch-up: where the client left off, and the last
 * Snowflake id it holds. Both ids cross the wire as strings per AGENTS.md
 * section 4, parsed by the same decorators as every other inbound id.
 */
export class CatchUpChannelDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;

  @IsSnowflake()
  @TransformSnowflake()
  afterMessageId!: bigint;
}

/**
 * The client → server `catch_up` frame (#68): every channel the client holds
 * state for at once, rather than one frame per channel — thirty frames fired
 * the instant a client reconnects is exactly the reconnection storm the
 * `ws-connect` budget exists to prevent.
 *
 * An empty list is valid: a client with nothing to catch up still gets an
 * ordinary `{ channels: [] }` reply instead of a validation error.
 */
export class CatchUpFrameDto {
  @IsArray()
  @ArrayMaxSize(CATCH_UP_MAX_CHANNELS)
  @ValidateNested({ each: true })
  @Type(() => CatchUpChannelDto)
  channels!: CatchUpChannelDto[];
}

/**
 * What one channel's entry in the reply carries: the messages after the id
 * the client named, oldest → newest (`getHistory`'s order in both
 * directions), and whether the per-channel cap cut the list short.
 *
 * `truncated` is the client's instruction, not decoration: true means "this
 * list is not the whole gap — load history the normal way instead of
 * rendering it".
 */
export interface CatchUpChannelResponse {
  channelId: string;
  messages: MessageResponse[];
  truncated: boolean;
}

/**
 * Success: the reply itself. It answers in the ack rather than as a
 * broadcast, because this is a reply to one client — nobody else is behind,
 * and nobody else should see what one caller asked for.
 */
export interface CatchUpSuccess {
  channels: CatchUpChannelResponse[];
}

/** The direct reply to the sender: the catch-up, or the shared failure shape. */
export type CatchUpAck = CatchUpSuccess | AckFailure;

/** Validates a raw `catch_up` payload — see `parseFrame` for the why. */
export function parseCatchUpFrame(raw: unknown): Promise<CatchUpFrameDto> {
  return parseFrame(CatchUpFrameDto, raw);
}
