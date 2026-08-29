import { ExecutionContext } from '@nestjs/common';
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

function fakeContext(
  target: object,
  handlerName: string,
  response: { setHeader: jest.Mock },
): ExecutionContext {
  const handler = (target as Record<string, () => void>)[handlerName];

  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({
      getRequest: () => ({ ip: IP }),
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
});
