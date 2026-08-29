import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { RedisService } from '../src/common/redis.service';
import { RateLimit } from '../src/rate-limiter/rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

let hits = 0;

/**
 * No real REST route carries `@RateLimit(...)` yet, so the 429 contract is
 * exercised through a controller that lives only in this file, mounted
 * alongside the real `AppModule` so the real `APP_GUARD` is in the path —
 * same approach as `test/errors.e2e-spec.ts` for the exception filter.
 */
@Controller('probe')
class RateLimitProbeController {
  @Get('limited')
  @RateLimit('strict-mutation')
  limited(): { hits: number } {
    hits += 1;
    return { hits };
  }

  @Get('unlimited')
  unlimited(): { ok: true } {
    return { ok: true };
  }
}

describe('Rate limit guard (e2e)', () => {
  let app: INestApplication<App>;
  let redis: RedisService;
  const capacity = RATE_LIMIT_POLICIES['strict-mutation'].capacity;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RateLimitProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    redis = moduleFixture.get(RedisService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    hits = 0;

    // Every test shares one caller address (supertest has no real network
    // hop to vary it from), so the bucket has to be wiped between tests
    // rather than assumed fresh.
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  it('allows requests within capacity and reports the X-RateLimit-* headers', async () => {
    const response = await request(app.getHttpServer()).get('/probe/limited');

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe(String(capacity));
    expect(response.headers['x-ratelimit-remaining']).toBe(
      String(capacity - 1),
    );
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('rejects the request once over budget, without running the handler', async () => {
    for (let i = 0; i < capacity; i += 1) {
      await request(app.getHttpServer()).get('/probe/limited');
    }

    const hitsBeforeRejection = hits;
    const response = await request(app.getHttpServer()).get('/probe/limited');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(response.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: expect.any(String) as string,
        details: expect.anything() as unknown,
      },
    });

    // The handler body increments `hits` on every real call; if the guard let
    // the rejected request through, this would have gone up by one too.
    expect(hits).toBe(hitsBeforeRejection);
  });

  it('never rate-limits an undecorated route', async () => {
    for (let i = 0; i < capacity + 5; i += 1) {
      const response = await request(app.getHttpServer()).get(
        '/probe/unlimited',
      );
      expect(response.status).toBe(200);
    }
  });

  it('leaves GET /health unaffected', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
