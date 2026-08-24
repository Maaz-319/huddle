import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from './errors';

describe('domain errors', () => {
  const cases: [new (message: string) => DomainError, string, number][] = [
    [ValidationError, 'VALIDATION_FAILED', 400],
    [ForbiddenError, 'FORBIDDEN', 403],
    [NotFoundError, 'NOT_FOUND', 404],
    [ConflictError, 'CONFLICT', 409],
  ];

  it.each(cases)('%p carries its own code and status', (Cls, code, status) => {
    const error = new Cls('something went wrong');

    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe('something went wrong');
    expect(error.name).toBe(Cls.name);
  });

  it.each(cases)(
    '%p survives the prototype chain of extending Error',
    (Cls) => {
      const error = new Cls('something went wrong');

      // Extending a built-in silently resets the prototype unless the base
      // constructor restores it, which would make the filter treat every
      // domain error as an unknown 500.
      expect(error).toBeInstanceOf(Cls);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
    },
  );

  it('keeps the details it was given', () => {
    const error = new NotFoundError('Channel not found', {
      channelId: '123456789',
    });

    expect(error.details).toEqual({ channelId: '123456789' });
  });

  it('leaves details undefined when none were given', () => {
    expect(new ForbiddenError('nope').details).toBeUndefined();
  });

  it('RateLimitedError carries the retry-after seconds and its details', () => {
    const error = new RateLimitedError('Slow down', 30, { bucket: 'messages' });

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(30);
    expect(error.details).toEqual({ bucket: 'messages' });
  });
});
