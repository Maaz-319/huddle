import { ValidationError } from '../../src/common/errors';
import {
  MessageDeleteFrameDto,
  parseMessageDeleteFrame,
} from './message-delete.frame';
import { IDEMPOTENCY_KEY_MAX } from './socket-frame';

const CHANNEL_ID = '890123456789012345';
const MESSAGE_ID = '890123456789012346';

function validFrame(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    idempotencyKey: 'd9a2e6c3-8f4b-4c99-814e-2c5f7a8b9c0d',
    ...overrides,
  };
}

describe('MessageDeleteFrameDto', () => {
  describe('parseMessageDeleteFrame', () => {
    it('parses a valid frame, with both ids as bigints', async () => {
      const frame = await parseMessageDeleteFrame(validFrame());

      expect(frame).toBeInstanceOf(MessageDeleteFrameDto);
      expect(frame.channelId).toBe(BigInt(CHANNEL_ID));
      expect(frame.messageId).toBe(BigInt(MESSAGE_ID));
      expect(frame.idempotencyKey).toBe('d9a2e6c3-8f4b-4c99-814e-2c5f7a8b9c0d');
    });

    it('rejects a channel id that is not a Snowflake string', async () => {
      await expect(
        parseMessageDeleteFrame(validFrame({ channelId: 'not-an-id' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a message id sent as a JSON number', async () => {
      // IDs cross the wire as strings in both directions: a double cannot
      // hold 64 bits without losing precision (AGENTS.md section 4) — this
      // literal is itself kept inside the safe range so the test file is not
      // the thing losing precision.
      await expect(
        parseMessageDeleteFrame(validFrame({ messageId: 8901234567890123 })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a missing message id', async () => {
      const withoutId: Record<string, unknown> = validFrame();
      delete withoutId.messageId;

      await expect(parseMessageDeleteFrame(withoutId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects a missing idempotency key', async () => {
      const withoutKey: Record<string, unknown> = validFrame();
      delete withoutKey.idempotencyKey;

      await expect(parseMessageDeleteFrame(withoutKey)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects an empty idempotency key', async () => {
      await expect(
        parseMessageDeleteFrame(validFrame({ idempotencyKey: '' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an idempotency key longer than the bound', async () => {
      await expect(
        parseMessageDeleteFrame(
          validFrame({ idempotencyKey: 'k'.repeat(IDEMPOTENCY_KEY_MAX + 1) }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects fields the frame schema does not declare', async () => {
      await expect(
        parseMessageDeleteFrame(validFrame({ content: 'goodbye' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a payload that is not an object at all', async () => {
      await expect(parseMessageDeleteFrame('delete it')).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageDeleteFrame(null)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageDeleteFrame(undefined)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
