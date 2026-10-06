import { plainToInstance } from 'class-transformer';
import { IsString, Length, validate } from 'class-validator';
import { DomainError, RateLimitedError } from '../common/errors';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import { validationExceptionFactory } from '../common/validation-exception.factory';
import { SendMessageDto } from './send-message.dto';

/**
 * How long an idempotency key may be. The doc calls it a nonce (a UUID is 36
 * characters, a ULID 26), but it arrives from the client and is used verbatim
 * as one segment of a Redis key — so it gets a bound rather than being
 * trusted to be short. A key this long still leaves plenty of room for any
 * sane generator.
 */
export const IDEMPOTENCY_KEY_MAX = 128;

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
 * idempotency key.
 */
export class MessageSendFrameDto extends SendMessageDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;

  @IsString()
  @Length(1, IDEMPOTENCY_KEY_MAX)
  idempotencyKey!: string;
}

/** The machine-readable failure a client's auto-retry keys off. */
export interface AckError {
  code: string;

  /**
   * Whether the client may retry the same frame as-is. `true` only for
   * budget refusals — retrying a forbidden send or an invalid body would
   * fail identically forever, which is exactly the auto-retry loop
   * `chat-service.md` section 4 says this flag exists to stop.
   */
  retryable: boolean;
}

/** Success: the optimistic bubble is swapped for the real message. */
export interface SendAckSuccess {
  idempotencyKey: string;
  messageId: string;
  createdAt: string;
}

/** Failure: the client marks the bubble failed and reads `error.retryable`. */
export interface SendAckFailure {
  /**
   * Echoed so the client can match the reply to the bubble it sent. Absent
   * only when the frame was too malformed to name one (no key, or a
   * non-string key) — there is nothing honest to echo in that case, and the
   * client knows which key it sent anyway.
   */
  idempotencyKey?: string;
  error: AckError;
}

/**
 * The direct reply to the sender, separate from the `message_create`
 * broadcast (chat-service.md section 4): it goes through socket.io's emit
 * acknowledgement — literally an "ack" — and so reaches only the client that
 * sent the frame, scoped to that one event.
 */
export type SendAck = SendAckSuccess | SendAckFailure;

/**
 * Validates a raw `message_send` payload, against the same rules the global
 * `ValidationPipe` applies to REST bodies — `whitelist` and
 * `forbidNonWhitelisted` are its options (common.module.ts), and
 * `plainToInstance` is the `transform: true` half.
 *
 * Run here rather than relying on a `@MessageBody` pipe: a pipe failure
 * never reaches the handler, so it could not produce the error ack the
 * protocol requires (socket.io delivers an uncaught handler error as nothing
 * but a server-side log). Validation is sequenced as step one of the handler
 * precisely so its failure *can* be acked with its `idempotencyKey`.
 *
 * A non-object payload is validated as an empty frame — every field then
 * fails its own rule, and the client gets one ordinary `VALIDATION_FAILED`
 * ack instead of a transport-level surprise.
 */
export async function parseMessageSendFrame(
  raw: unknown,
): Promise<MessageSendFrameDto> {
  const source =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const frame = plainToInstance(MessageSendFrameDto, source);
  const errors = await validate(frame, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) throw validationExceptionFactory(errors);

  return frame;
}

/**
 * The `idempotencyKey` to echo on a failure, read off the raw payload —
 * validation may be what failed, and this must work before (or without) a
 * parsed frame existing.
 */
export function ackKeyOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;

  const candidate = (raw as { idempotencyKey?: unknown }).idempotencyKey;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Any thrown value → the `error` half of a failure ack.
 *
 * Pure and total: the handler funnels every escape from the send path
 * through here, so a frame can never be dropped silently and the client can
 * always tell a retryable refusal from a terminal one. An unrecognised
 * value is a bug rather than a handled failure — logged by the caller, and
 * answered non-retryable so a client does not loop on it.
 */
export function ackErrorFrom(error: unknown): AckError {
  if (error instanceof RateLimitedError) {
    return { code: error.code, retryable: true };
  }

  if (error instanceof DomainError) {
    return { code: error.code, retryable: false };
  }

  return { code: 'INTERNAL_ERROR', retryable: false };
}
