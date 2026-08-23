import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../src/common/redis.service';

/**
 * RedisService against the real Docker Redis.
 *
 * Reading process.env directly is correct here, for the same reason as in
 * prisma-test-client.ts: this is test infrastructure running outside the Nest
 * application, with no validated ConfigService in scope.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Everything this suite writes lives under one prefix and is deleted between
// cases, so running `npm run test:integration` twice in a row passes both times
// and nothing here can collide with a development key.
const PREFIX = 'huddle:test:redis-integration:';

describe('RedisService against a real Redis', () => {
  let redis: RedisService;

  const build = async (): Promise<RedisService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { get: () => REDIS_URL } },
      ],
    }).compile();

    const service = module.get(RedisService);
    await service.ping();
    return service;
  };

  beforeAll(async () => {
    redis = await build();
  });

  afterEach(async () => {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    if (redis.status !== 'end') await redis.quit();
  });

  it('writes a value and reads the same one back', async () => {
    await redis.set(`${PREFIX}greeting`, 'hello huddle');

    await expect(redis.get(`${PREFIX}greeting`)).resolves.toBe('hello huddle');
  });

  it('returns null for a key that was never written', async () => {
    await expect(redis.get(`${PREFIX}absent`)).resolves.toBeNull();
  });

  it('expires a key on its TTL', async () => {
    // Rate-limit buckets, presence entries, and idempotency keys are all
    // TTL'd, so a working expiry is part of the contract, not a Redis trivium.
    await redis.set(`${PREFIX}ephemeral`, 'gone soon', 'PX', 50);
    await expect(redis.get(`${PREFIX}ephemeral`)).resolves.toBe('gone soon');

    await new Promise((resolve) => setTimeout(resolve, 120));

    await expect(redis.get(`${PREFIX}ephemeral`)).resolves.toBeNull();
  });

  it('runs a Lua script through the connection, as the rate limiter will', async () => {
    const sum = await redis.eval(
      'return tonumber(ARGV[1]) + tonumber(ARGV[2])',
      0,
      '2',
      '40',
    );

    expect(sum).toBe(42);
  });

  it('leaves no open connection behind after module destroy', async () => {
    const closing = await build();
    expect(closing.status).toBe('ready');

    // `quit` resolves once Redis has acknowledged it; the socket closes a tick
    // later, which is when ioredis emits `end` and flips status. Waiting on the
    // event rather than the resolved promise is what makes this an assertion
    // about the connection actually being gone.
    // The timer is cleared either way -- an uncleared one keeps the event loop
    // alive past the run and Jest reports the suite as leaking a handle.
    let timer: NodeJS.Timeout;
    const ended = new Promise<void>((resolve, reject) => {
      closing.once('end', resolve);
      timer = setTimeout(
        () => reject(new Error('connection never closed')),
        2000,
      );
    }).finally(() => clearTimeout(timer));

    await closing.onModuleDestroy();
    await ended;

    expect(closing.status).toBe('end');
  });
});
