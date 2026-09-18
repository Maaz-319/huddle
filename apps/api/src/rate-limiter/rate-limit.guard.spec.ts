import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FakeRateLimitStore } from '../../test/fakes/fake-rate-limit-store';
import { RateLimitedError } from '../common/errors';
import { RateLimit } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMIT_POLICIES } from './rate-limit-policies';
import { RateLimitStore } from './rate-limit-store.interface';
import { RateLimiterService } from './rate-limiter.service';

const IP = '203.0.113.7';

/** Undecorated: no policy on either the class or the handler. */
class PlainController {
  handler(): void {}
}

/** Class-level policy, inherited by any handler that doesn't override it. */
@RateLimit('read')
class ClassPolicyController {
  handler(): void {}
}

/** A handler-level policy overriding the class-level one. */
@RateLimit('read')
class HandlerOverrideController {
  @RateLimit('strict-mutation')
  handler(): void {}
}

/**
 * A channel-dimensioned policy, as `POST /channels/:channelId/messages`
 * carries it. Its bucket cannot be keyed without a channel id off the route.
 */
@RateLimit('message-send')
class ChannelPolicyController {
  handler(): void {}
}

function fakeContext(
  target: object,
  handlerName: string,
  response: { setHeader: jest.Mock },
  sessionUserId?: string,
  params: Record<string, string> = {},
): ExecutionContext {
  const handler = (target as Record<string, () => void>)[handlerName];

  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        ip: IP,
        session: { userId: sessionUserId },
        params,
      }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let store: FakeRateLimitStore;
  let response: { setHeader: jest.Mock };

  beforeEach(async () => {
    store = new FakeRateLimitStore();
    response = { setHeader: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        Reflector,
        RateLimiterService,
        { provide: RateLimitStore, useValue: store },
      ],
    }).compile();

    guard = moduleRef.get(RateLimitGuard);
  });

  it('makes no store call at all on an undecorated route', async () => {
    const spend = jest.spyOn(store, 'consume');
    const instance = new PlainController();

    const result = await guard.canActivate(
      fakeContext(instance, 'handler', response),
    );

    expect(result).toBe(true);
    expect(spend).not.toHaveBeenCalled();
  });

  it('allows a within-budget request and sets the X-RateLimit-* headers', async () => {
    const instance = new ClassPolicyController();

    const result = await guard.canActivate(
      fakeContext(instance, 'handler', response),
    );

    expect(result).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Limit',
      RATE_LIMIT_POLICIES.read.capacity,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      RATE_LIMIT_POLICIES.read.capacity - 1,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(Number),
    );
  });

  it('throws RateLimitedError with a rounded-up retryAfter once over budget', async () => {
    const instance = new ClassPolicyController();
    const capacity = RATE_LIMIT_POLICIES.read.capacity;

    for (let i = 0; i < capacity; i += 1) {
      await guard.canActivate(fakeContext(instance, 'handler', response));
    }

    await expect(
      guard.canActivate(fakeContext(instance, 'handler', response)),
    ).rejects.toThrow(RateLimitedError);

    try {
      await guard.canActivate(fakeContext(instance, 'handler', response));
      throw new Error('expected RateLimitedError');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as RateLimitedError).retryAfter).toBeGreaterThanOrEqual(1);
    }
  });

  it('keys a user-dimensioned policy on the session userId, not the IP', async () => {
    const spend = jest.spyOn(store, 'consume');
    const instance = new ClassPolicyController();

    await guard.canActivate(
      fakeContext(instance, 'handler', response, '300000000000000001'),
    );

    expect(spend).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining(':user:300000000000000001') as string,
      }),
    );
  });

  it('lets a handler-level policy override the class-level one', async () => {
    const spend = jest.spyOn(store, 'consume');
    const instance = new HandlerOverrideController();

    await guard.canActivate(fakeContext(instance, 'handler', response));

    expect(spend).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining('strict-mutation') as string,
      }),
    );
  });

  describe('a channel-dimensioned policy', () => {
    const CHANNEL_ID = '400000000000000001';
    const OTHER_CHANNEL_ID = '400000000000000002';
    const USER_ID = '300000000000000001';

    it('keys the bucket on the :channelId route param', async () => {
      const spend = jest.spyOn(store, 'consume');
      const instance = new ChannelPolicyController();

      await guard.canActivate(
        fakeContext(instance, 'handler', response, USER_ID, {
          channelId: CHANNEL_ID,
        }),
      );

      expect(spend).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining(`:channel:${CHANNEL_ID}`) as string,
        }),
      );
    });

    it('gives two channels two separate buckets', async () => {
      // The whole point of the channel dimension: a burst in one channel must
      // not spend another channel's budget. Keying on the user instead would
      // still 429 plausibly, which is the version of this bug nobody notices.
      const instance = new ChannelPolicyController();
      const capacity = RATE_LIMIT_POLICIES['message-send'].capacity;

      for (let i = 0; i < capacity; i += 1) {
        await guard.canActivate(
          fakeContext(instance, 'handler', response, USER_ID, {
            channelId: CHANNEL_ID,
          }),
        );
      }

      await expect(
        guard.canActivate(
          fakeContext(instance, 'handler', response, USER_ID, {
            channelId: CHANNEL_ID,
          }),
        ),
      ).rejects.toBeInstanceOf(RateLimitedError);

      await expect(
        guard.canActivate(
          fakeContext(instance, 'handler', response, USER_ID, {
            channelId: OTHER_CHANNEL_ID,
          }),
        ),
      ).resolves.toBe(true);
    });

    it('keys on the channel even when the caller has a session', async () => {
      // A user-dimensioned reading of the same request would key on userId;
      // asserting the channel id is present is not enough on its own.
      const spend = jest.spyOn(store, 'consume');
      const instance = new ChannelPolicyController();

      await guard.canActivate(
        fakeContext(instance, 'handler', response, USER_ID, {
          channelId: CHANNEL_ID,
        }),
      );

      expect(spend).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.not.stringContaining(`:user:${USER_ID}`) as string,
        }),
      );
    });

    it('rejects a malformed channel id with a 400 rather than a 500', async () => {
      // Guards run before pipes, so `/channels/abc/messages` reaches here with
      // `abc` still a raw string. Passing it on as "no channel" would throw
      // inside buildRateLimitKey and render as a 500.
      const instance = new ChannelPolicyController();

      await expect(
        guard.canActivate(
          fakeContext(instance, 'handler', response, USER_ID, {
            channelId: 'not-a-snowflake',
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not read the route params for a policy of another dimension', async () => {
      // Only channel-dimensioned policies pay for the lookup; a `read` route
      // with a :channelId param still keys on the user.
      const spend = jest.spyOn(store, 'consume');
      const instance = new ClassPolicyController();

      await guard.canActivate(
        fakeContext(instance, 'handler', response, USER_ID, {
          channelId: CHANNEL_ID,
        }),
      );

      expect(spend).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining(`:user:${USER_ID}`) as string,
        }),
      );
    });
  });
});
