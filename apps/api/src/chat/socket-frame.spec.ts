import {
  ForbiddenError,
  RateLimitedError,
  ValidationError,
} from '../../src/common/errors';
import { ackErrorFrom, ackKeyOf } from './socket-frame';

describe('socket-frame ack contract', () => {
  describe('ackKeyOf', () => {
    it('reads the key off a raw payload', () => {
      expect(
        ackKeyOf({
          channelId: '890123456789012345',
          content: 'hello there',
          idempotencyKey: 'b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b',
        }),
      ).toBe('b7e0c4a1-6d2f-4a77-9f2c-0a3d5e6f7a8b');
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
