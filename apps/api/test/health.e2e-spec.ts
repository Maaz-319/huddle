import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the process, the database, and Redis as up', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    const up = {
      app: { status: 'up' },
      database: { status: 'up' },
      redis: { status: 'up' },
    };

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      info: up,
      error: {},
      details: up,
    });
  });

  it('returns 404 for a route that does not exist', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope');

    expect(response.status).toBe(404);
  });
});
