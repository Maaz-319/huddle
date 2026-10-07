import { ValidationError } from '../../src/common/errors';
import { parseTypingFrame, TypingFrameDto } from './typing.frame';

const CHANNEL_ID = '890123456789012345';

function validFrame(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { channelId: CHANNEL_ID, ...overrides };
}

describe('TypingFrameDto', () => {
  describe('parseTypingFrame', () => {
    it('parses a valid frame, with the channel id as a bigint', async () => {
      const frame = await parseTypingFrame(validFrame());

      expect(frame).toBeInstanceOf(TypingFrameDto);
      expect(frame.channelId).toBe(BigInt(CHANNEL_ID));
    });

    it('rejects a channel id that is not a Snowflake string', async () => {
      await expect(
        parseTypingFrame(validFrame({ channelId: 'not-an-id' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a channel id sent as a JSON number', async () => {
      // IDs cross the wire as strings in both directions: a double cannot
      // hold 64 bits without losing precision (AGENTS.md section 4).
      await expect(
        parseTypingFrame(validFrame({ channelId: 8901234567890123 })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a missing channel id', async () => {
      await expect(parseTypingFrame({})).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects fields the frame schema does not declare', async () => {
      // Identity never comes from frame content (#70's adversarial sweep
      // leans on this): a forged userId is a validation failure, not data.
      await expect(
        parseTypingFrame(validFrame({ userId: '890123456789012346' })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        parseTypingFrame(validFrame({ idempotencyKey: 'nonce' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a payload that is not an object at all', async () => {
      await expect(parseTypingFrame('typing')).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseTypingFrame(null)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseTypingFrame(undefined)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
