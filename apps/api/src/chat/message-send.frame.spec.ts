import {
  ForbiddenError,
  RateLimitedError,
  ValidationError,
} from '../../src/common/errors';
import {
  ackErrorFrom,
  ackKeyOf,
  IDEMPOTENCY_KEY_MAX,
  MessageSendFrameDto,
  parseMessageSendFrame,
} from './message-send.frame';

const CHANNEL_ID = '890123456789012345';

function validFrame(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    content: 'hello there',
    idempotencyKey: 'b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b',
    ...overrides,
  };
}

describe('MessageSendFrameDto', () => {
  describe('parseMessageSendFrame', () => {
    it('parses a valid frame, with the channel as a bigint', async () => {
      const frame = await parseMessageSendFrame(validFrame());

      expect(frame).toBeInstanceOf(MessageSendFrameDto);
      expect(frame.channelId).toBe(BigInt(CHANNEL_ID));
      expect(frame.content).toBe('hello there');
      expect(frame.idempotencyKey).toBe('b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b');
    });

    it('trims content before checking it, exactly as the REST body does', async () => {
      const frame = await parseMessageSendFrame(
        validFrame({ content: '  padded  ' }),
      );

      expect(frame.content).toBe('padded');
    });

    it('rejects whitespace-only content', async () => {
      await expect(
        parseMessageSendFrame(validFrame({ content: '   \n  ' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects content over 2048 characters after trimming', async () => {
      await expect(
        parseMessageSendFrame(validFrame({ content: 'x'.repeat(2049) })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts content of exactly 2048 characters', async () => {
      const frame = await parseMessageSendFrame(
        validFrame({ content: 'x'.repeat(2048) }),
      );

      expect(frame.content).toHaveLength(2048);
    });

    it('rejects a channel id that is not a Snowflake string', async () => {
      await expect(
        parseMessageSendFrame(validFrame({ channelId: 'not-an-id' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a channel id sent as a JSON number', async () => {
      // IDs cross the wire as strings in both directions: a double cannot
      // hold 64 bits without losing precision (AGENTS.md section 4) — this
      // literal is itself kept inside the safe range so the test file is not
      // the thing losing precision.
      await expect(
        parseMessageSendFrame(validFrame({ channelId: 8901234567890123 })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a missing idempotency key', async () => {
      const withoutKey: Record<string, unknown> = validFrame();
      delete withoutKey.idempotencyKey;

      await expect(parseMessageSendFrame(withoutKey)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects an empty idempotency key', async () => {
      await expect(
        parseMessageSendFrame(validFrame({ idempotencyKey: '' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an idempotency key longer than the bound', async () => {
      await expect(
        parseMessageSendFrame(
          validFrame({ idempotencyKey: 'k'.repeat(IDEMPOTENCY_KEY_MAX + 1) }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects fields the frame schema does not declare', async () => {
      // Mirrors the global ValidationPipe's `forbidNonWhitelisted`, so REST
      // and the socket accept exactly the same field sets.
      await expect(
        parseMessageSendFrame(validFrame({ isAdmin: true })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a payload that is not an object at all', async () => {
      await expect(parseMessageSendFrame('send it')).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageSendFrame(null)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageSendFrame(undefined)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('ackKeyOf', () => {
    it('reads the key off a raw payload', () => {
      expect(ackKeyOf(validFrame())).toBe(
        'b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b',
      );
    });

    it('has nothing to echo when there is no usable key', () => {
      expect(ackKeyOf(null)).toBeUndefined();
      expect(ackKeyOf('string')).toBeUndefined();
      expect(ackKeyOf({ idempotencyKey: 42 })).toBeUndefined();
      expect(ackKeyOf({})).toBeUndefined();
    });
  });

  describe('ackErrorFrom', () => {
    it('marks a rate-limit refusal retryable', () => {
      expect(ackErrorFrom(new RateLimitedError('Slow down', 1))).toEqual({
        code: 'RATE_LIMITED',
        retryable: true,
      });
    });

    it('marks domain refusals non-retryable, keeping their code', () => {
      expect(
        ackErrorFrom(new ForbiddenError('Insufficient capability')),
      ).toEqual({ code: 'FORBIDDEN', retryable: false });
      expect(
        ackErrorFrom(new ValidationError('Request validation failed')),
      ).toEqual({ code: 'VALIDATION_FAILED', retryable: false });
    });

    it('marks anything unrecognised as a non-retryable internal error', () => {
      expect(ackErrorFrom(new TypeError('boom'))).toEqual({
        code: 'INTERNAL_ERROR',
        retryable: false,
      });
      expect(ackErrorFrom('just a string')).toEqual({
        code: 'INTERNAL_ERROR',
        retryable: false,
      });
    });
  });
});
