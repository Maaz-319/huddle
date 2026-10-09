import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { RedisOptions } from 'ioredis';
import { RedisService } from './redis.service';
import { LoggerService } from './logger.service';

/** Arguments every construction of the ioredis client was given. */
const mockConstructorCalls: [string, RedisOptions][] = [];

// No socket is opened here: `npm test` must pass with no Docker running. The
// stand-in records what `super(...)` was called with, so the connection options
// the service builds can be asserted on directly.
jest.mock('ioredis', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');

  class MockRedis extends EventEmitter {
    ping = jest.fn().mockResolvedValue('PONG');
    quit = jest.fn().mockResolvedValue('OK');
    disconnect = jest.fn();

    constructor(url: string, options: RedisOptions) {
      super();
      mockConstructorCalls.push([url, options]);
    }
  }

  return { Redis: MockRedis };
});

describe('RedisService', () => {
  const REDIS_URL = 'rediss://user:pass@redis.example:6380';
  const get = jest.fn().mockReturnValue(REDIS_URL);
  let service: RedisService;

  /** The options object the service handed to the ioredis constructor. */
  const constructedWith = (): RedisOptions => mockConstructorCalls[0][1];

  beforeEach(async () => {
    mockConstructorCalls.length = 0;
    get.mockClear();

    const mockLogger = {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get } },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(RedisService);
  });

  it('takes its URL from ConfigService, not process.env', () => {
    expect(get).toHaveBeenCalledWith('REDIS_URL', { infer: true });
  });

  it('passes the configured URL through verbatim, scheme included', () => {
    // A rediss:// URL must survive untouched -- Redis Cloud needs TLS, and
    // nothing may assemble the connection from parts.
    expect(mockConstructorCalls[0][0]).toBe(REDIS_URL);
  });

  it('bounds how long a command waits on a downed connection', () => {
    expect(constructedWith()).toMatchObject({
      maxRetriesPerRequest: 2,
      // On, so the first command after boot does not race the socket.
      enableOfflineQueue: true,
    });
  });

  describe('retryStrategy', () => {
    const retryAfter = (times: number): number | void | null => {
      const strategy = constructedWith().retryStrategy;
      if (!strategy) throw new Error('no retryStrategy was configured');
      return strategy.call(service, times);
    };

    it('backs off in steps of 200ms', () => {
      expect(retryAfter(1)).toBe(200);
      expect(retryAfter(3)).toBe(600);
    });

    it('caps the delay at 2s however long the outage runs', () => {
      expect(retryAfter(10)).toBe(2000);
    });

    it('gives up after 10 attempts', () => {
      expect(retryAfter(11)).toBeNull();
    });
  });

  it('quits the connection on module destroy', async () => {
    const quit = jest.spyOn(service, 'quit');

    await service.onModuleDestroy();

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('forces the socket closed when a clean quit fails', async () => {
    jest
      .spyOn(service, 'quit')
      .mockRejectedValue(new Error('Connection is closed.'));
    const disconnect = jest.spyOn(service, 'disconnect');

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('survives the error events ioredis emits on a failed reconnect', () => {
    // An unhandled 'error' on an EventEmitter takes the process down, so the
    // listener existing is the whole point of this case.
    expect(() =>
      service.emit('error', new Error('ECONNREFUSED')),
    ).not.toThrow();
  });
});
