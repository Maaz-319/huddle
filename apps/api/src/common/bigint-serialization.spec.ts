import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { patchBigIntSerialization } from './bigint-serialization';
import { ParseSnowflakePipe } from './parse-snowflake.pipe';
import { SnowflakeService } from './snowflake.service';

@Controller('ids')
class IdsController {
  constructor(private readonly snowflakes: SnowflakeService) {}

  @Get()
  mint() {
    return { id: this.snowflakes.generate(), nested: [{ id: 42n }] };
  }

  @Get(':id')
  echo(@Param('id', ParseSnowflakePipe) id: bigint) {
    return { id, createdAt: this.snowflakes.timestampFrom(id) };
  }
}

describe('BigInt serialization', () => {
  it('is impossible without the patch — JSON.stringify throws on a bigint', () => {
    expect(() => JSON.stringify({ id: 1n })).toThrow(TypeError);
  });

  describe('once patched', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      patchBigIntSerialization();

      const moduleFixture = await Test.createTestingModule({
        controllers: [IdsController],
        providers: [SnowflakeService],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('serializes a bigint as a JSON string', () => {
      expect(JSON.stringify({ id: 1n })).toBe('{"id":"1"}');
    });

    it('lets a controller return an object containing a bigint', async () => {
      const response = await request(app.getHttpServer()).get('/ids');
      const body = response.body as { id: string; nested: { id: string }[] };

      expect(response.status).toBe(200);
      expect(typeof body.id).toBe('string');
      expect(body.id).toMatch(/^[1-9]\d*$/);
      expect(body.nested[0].id).toBe('42');
    });

    it('accepts a valid ID on a route using ParseSnowflakePipe', async () => {
      const response = await request(app.getHttpServer()).get(
        '/ids/7311047234159968256',
      );

      const body = response.body as { id: string };

      expect(response.status).toBe(200);
      expect(body.id).toBe('7311047234159968256');
    });

    it('rejects a route parameter that is not a Snowflake with a 400', async () => {
      const response = await request(app.getHttpServer()).get('/ids/abc');

      expect(response.status).toBe(400);
    });
  });
});
