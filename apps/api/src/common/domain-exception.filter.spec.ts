import {
  ArgumentsHost,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DomainExceptionFilter } from './domain-exception.filter';
import { LoggerService } from './logger.service';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from './errors';

describe('DomainExceptionFilter', () => {
  const response = Symbol('response');

  let reply: jest.Mock;
  let setHeader: jest.Mock;
  let filter: DomainExceptionFilter;
  let host: ArgumentsHost;
  let logger: LoggerService;

  beforeEach(() => {
    reply = jest.fn();
    setHeader = jest.fn();

    const adapterHost = {
      httpAdapter: { reply, setHeader },
    } as unknown as HttpAdapterHost;

    logger = {
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      setCorrelationId: jest.fn(),
      clearCorrelationId: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService;

    filter = new DomainExceptionFilter(adapterHost, logger);

    host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
  });

  const domainCases: [DomainError, string, number][] = [
    [new ValidationError('bad body'), 'VALIDATION_FAILED', 400],
    [new ForbiddenError('not yours'), 'FORBIDDEN', 403],
    [new NotFoundError('no such channel'), 'NOT_FOUND', 404],
    [new ConflictError('already exists'), 'CONFLICT', 409],
    [new RateLimitedError('slow down', 12), 'RATE_LIMITED', 429],
  ];

  it.each(domainCases)(
    'renders %p as its own status and code',
    (error, code, status) => {
      filter.catch(error, host);

      expect(reply).toHaveBeenCalledWith(
        response,
        { error: { code, message: error.message } },
        status,
      );
    },
  );

  it('includes details when the error carries them', () => {
    filter.catch(
      new NotFoundError('no such channel', { channelId: '7' }),
      host,
    );

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        error: {
          code: 'NOT_FOUND',
          message: 'no such channel',
          details: { channelId: '7' },
        },
      },
      404,
    );
  });

  it('omits details rather than sending an empty object', () => {
    filter.catch(new ForbiddenError('not yours'), host);

    const [, body] = reply.mock.calls[0] as [unknown, { error: object }];
    expect('details' in body.error).toBe(false);
  });

  it('sets Retry-After from a RateLimitedError', () => {
    filter.catch(new RateLimitedError('slow down', 12), host);

    expect(setHeader).toHaveBeenCalledWith(response, 'Retry-After', '12');
  });

  it('does not set Retry-After for any other error', () => {
    filter.catch(new ConflictError('already exists'), host);

    expect(setHeader).not.toHaveBeenCalled();
  });

  it('reshapes a Nest HttpException while keeping its status', () => {
    filter.catch(new NotFoundException('Cannot GET /nope'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { error: { code: 'NOT_FOUND', message: 'Cannot GET /nope' } },
      404,
    );
  });

  it('maps an HttpException status with no domain equivalent', () => {
    filter.catch(new UnauthorizedException(), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      401,
    );
  });

  describe('an unrecognised error', () => {
    let logged: jest.SpyInstance;

    beforeEach(() => {
      logged = jest.spyOn(logger, 'error').mockImplementation();
      filter.catch(new Error('postgres://user:hunter2@db:5432 refused'), host);
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it('becomes a generic 500 that leaks nothing', () => {
      const [, body, status] = reply.mock.calls[0] as [
        unknown,
        unknown,
        number,
      ];

      expect(status).toBe(500);
      expect(body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(JSON.stringify(body)).not.toContain('hunter2');
      expect(JSON.stringify(body)).not.toContain('at ');
    });

    it('is logged server-side with the real stack', () => {
      // logger.error is called with (context, message, meta)
      // meta.error contains the stack
      const [, , meta] = logged.mock.calls[0] as [
        string,
        string,
        { error: string },
      ];

      expect(meta.error).toContain('hunter2');
    });
  });

  it('handles a thrown non-Error without crashing the filter', () => {
    const logged = jest.spyOn(logger, 'error').mockImplementation();

    filter.catch('just a string', host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      500,
    );
    expect(logged).toHaveBeenCalledWith(
      'DomainExceptionFilter',
      'Unhandled exception',
      expect.any(Object),
    );

    logged.mockRestore();
  });
});
