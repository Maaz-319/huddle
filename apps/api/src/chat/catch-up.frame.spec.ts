import { ValidationError } from '../../src/common/errors';
import {
  CATCH_UP_MAX_CHANNELS,
  CatchUpFrameDto,
  parseCatchUpFrame,
} from './catch-up.frame';

const CHANNEL_ID = '890123456789012345';
const MESSAGE_ID = '890123456789012346';

function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    afterMessageId: MESSAGE_ID,
    ...overrides,
  };
}

function validFrame(
  channels: Record<string, unknown>[] = [entry()],
): Record<string, unknown> {
  return { channels };
}

describe('CatchUpFrameDto', () => {
  describe('parseCatchUpFrame', () => {
    it('parses a valid frame, with both ids as bigints', async () => {
      const frame = await parseCatchUpFrame(
        validFrame([entry(), entry({ channelId: '890123456789012399' })]),
      );

      expect(frame).toBeInstanceOf(CatchUpFrameDto);
      expect(frame.channels).toHaveLength(2);
      expect(frame.channels[0]?.channelId).toBe(BigInt(CHANNEL_ID));
      expect(frame.channels[0]?.afterMessageId).toBe(BigInt(MESSAGE_ID));
      expect(frame.channels[1]?.channelId).toBe(BigInt('890123456789012399'));
    });

    it('accepts an empty channel list — nothing to catch up is not an error', async () => {
      const frame = await parseCatchUpFrame(validFrame([]));

      expect(frame.channels).toEqual([]);
    });

    it('rejects a missing channels property', async () => {
      await expect(parseCatchUpFrame({})).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects channels that is not an array', async () => {
      await expect(
        parseCatchUpFrame({ channels: CHANNEL_ID }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        parseCatchUpFrame({ channels: { 0: entry() } }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects more channel entries than the frame bound allows', async () => {
      // The frame's bound is what stops validation itself from being handed
      // an unbounded work set — the same shape of stop as the per-channel
      // message cap, one level up.
      const flood = Array.from({ length: CATCH_UP_MAX_CHANNELS + 1 }, () =>
        entry(),
      );

      await expect(parseCatchUpFrame(validFrame(flood))).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects an entry with a missing afterMessageId', async () => {
      await expect(
        parseCatchUpFrame(validFrame([{ channelId: CHANNEL_ID }])),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an entry with a channel id that is not a Snowflake string', async () => {
      await expect(
        parseCatchUpFrame(validFrame([entry({ channelId: 'not-an-id' })])),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects ids sent as JSON numbers', async () => {
      // IDs cross the wire as strings in both directions: a double cannot
      // hold 64 bits without losing precision (AGENTS.md section 4).
      await expect(
        parseCatchUpFrame(
          validFrame([
            entry({ channelId: 8901234567890123, afterMessageId: MESSAGE_ID }),
          ]),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        parseCatchUpFrame(
          validFrame([
            entry({ channelId: CHANNEL_ID, afterMessageId: 8901234567890123 }),
          ]),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects fields the frame schema does not declare', async () => {
      await expect(
        parseCatchUpFrame(validFrame([entry({ userId: 'forged' })])),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        parseCatchUpFrame({ channels: [entry()], limit: 10_000 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an idempotency key — the frame carries no key at all', async () => {
      await expect(
        parseCatchUpFrame({
          channels: [entry()],
          idempotencyKey: 'b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a payload that is not an object at all', async () => {
      await expect(parseCatchUpFrame('catch_up')).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseCatchUpFrame(null)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseCatchUpFrame(undefined)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(parseCatchUpFrame([entry()])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
