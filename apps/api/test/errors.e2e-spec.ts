import { Controller, Get, INestApplication, Query } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { NotFoundError, RateLimitedError } from '../src/common/errors';
import { CursorPaginationDto } from '../src/common/pagination.dto';

/**
 * No feature route exists yet, so the error contract is exercised through a
 * controller that lives only in this file. It is mounted alongside the real
 * AppModule, which is what puts the real global pipe and filter in the path.
 */
@Controller('probe')
class ErrorProbeController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundError('Channel not found', { channelId: '123' });
  }

  @Get('rate-limited')
  rateLimited(): never {
    throw new RateLimitedError('Slow down', 30);
  }

  @Get('boom')
  boom(): never {
    throw new Error('postgres://user:hunter2@db:5432 refused');
  }

  @Get('paginated')
  paginated(@Query() query: CursorPaginationDto) {
    return { limit: query.limit, before: query.before };
  }
}

describe('Error responses (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders a domain error in the documented shape', async () => {
    const response = await request(app.getHttpServer()).get('/probe/not-found');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Channel not found',
        details: { channelId: '123' },
      },
    });
  });

  it('answers a rate-limited request with 429 and Retry-After', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/rate-limited',
    );

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Slow down' },
    });
  });

  it('hides an unexpected error behind a generic 500', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('hunter2');
    expect(response.text).not.toContain('at ');
  });

  it('renders a DTO validation failure in the same shape', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/paginated?limit=999',
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: { limit: ['limit must not be greater than 100'] },
      },
    });
  });

  it('rejects an unknown query parameter in the same shape', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/paginated?offset=10',
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('applies the pagination defaults on a valid request', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/paginated?before=175928847299117063',
    );

    expect(response.status).toBe(200);
    // The cursor comes back as a string because bigints serialise that way.
    expect(response.body).toEqual({ limit: 50, before: '175928847299117063' });
  });

  it('reshapes an unmatched route into the same envelope', async () => {
    const response = await request(app.getHttpServer()).get('/probe/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cannot GET /probe/nope' },
    });
  });
});
