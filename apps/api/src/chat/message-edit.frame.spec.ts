import { ValidationError } from '../../src/common/errors';
import {
  MessageEditFrameDto,
  parseMessageEditFrame,
} from './message-edit.frame';
import { IDEMPOTENCY_KEY_MAX } from './socket-frame';

const CHANNEL_ID = '890123456789012345';
const MESSAGE_ID = '890123456789012346';

function validFrame(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    content: 'a corrected thought',
    idempotencyKey: 'c8f1d5b2-7e3a-4b88-803d-1b4e6f7a8b9c',
    ...overrides,
  };
}

describe('MessageEditFrameDto', () => {
  describe('parseMessageEditFrame', () => {
    it('parses a valid frame, with both ids as bigints', async () => {
      const frame = await parseMessageEditFrame(validFrame());

      expect(frame).toBeInstanceOf(MessageEditFrameDto);
      expect(frame.channelId).toBe(BigInt(CHANNEL_ID));
      expect(frame.messageId).toBe(BigInt(MESSAGE_ID));
      expect(frame.content).toBe('a corrected thought');
      expect(frame.idempotencyKey).toBe('c8f1d5b2-7e3a-4b88-803d-1b4e6f7a8b9c');
    });

    it('trims content before checking it, exactly as the REST body does', async () => {
      const frame = await parseMessageEditFrame(
        validFrame({ content: '  padded  ' }),
      );

      expect(frame.content).toBe('padded');
    });

    it('rejects whitespace-only content', async () => {
      await expect(
        parseMessageEditFrame(validFrame({ content: '   \n  ' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects content over 2048 characters after trimming', async () => {
      await expect(
        parseMessageEditFrame(validFrame({ content: 'x'.repeat(2049) })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a channel id that is not a Snowflake string', async () => {
      await expect(
        parseMessageEditFrame(validFrame({ channelId: 'not-an-id' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a message id sent as a JSON number', async () => {
      // IDs cross the wire as strings in both directions: a double cannot
      // hold 64 bits without losing precision (AGENTS.md section 4) — this
      // literal is itself kept inside the safe range so the test file is not
      // the thing losing precision.
      await expect(
        parseMessageEditFrame(validFrame({ messageId: 8901234567890123 })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a missing message id', async () => {
      const withoutId: Record<string, unknown> = validFrame();
      delete withoutId.messageId;

      await expect(parseMessageEditFrame(withoutId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects a missing idempotency key', async () => {
      const withoutKey: Record<string, unknown> = validFrame();
      delete withoutKey.idempotencyKey;

      await expect(parseMessageEditFrame(withoutKey)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects an empty idempotency key', async () => {
      await expect(
        parseMessageEditFrame(validFrame({ idempotencyKey: '' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an idempotency key longer than the bound', async () => {
      await expect(
        parseMessageEditFrame(
          validFrame({ idempotencyKey: 'k'.repeat(IDEMPOTENCY_KEY_MAX + 1) }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects fields the frame schema does not declare', async () => {
      await expect(
        parseMessageEditFrame(validFrame({ authorId: 'someone-else' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a payload that is not an object at all', async () => {
      await expect(parseMessageEditFrame('edit it')).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageEditFrame(null)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseMessageEditFrame(undefined)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
