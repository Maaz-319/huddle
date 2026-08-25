import { Controller, Get, Ip, INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureTrustProxy } from './trust-proxy';

/**
 * A throwaway controller handing back whatever Nest resolved as the client
 * address. `@Ip()` reads `req.ip`, which is the value every per-IP rate-limit
 * bucket is keyed on — so this is the address under test, not a stand-in for
 * it.
 */
@Controller()
class WhoAmIController {
  @Get('whoami')
  whoami(@Ip() ip: string): string {
    return ip;
  }
}

/** A running app trusting exactly `hops` proxies in front of it. */
async function appTrusting(hops: number): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [WhoAmIController],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureTrustProxy(app, hops);

  return app.init();
}

describe('configureTrustProxy', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('ignores a forged X-Forwarded-For when no hop is trusted', async () => {
    // The attack this exists to stop: a client writes its own left-most entry,
    // hoping the app keys a per-IP bucket on it. Every request could then carry
    // a different address and never share a bucket with itself.
    app = await appTrusting(0);

    const forged = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', '203.0.113.7');
    const plain = await request(app.getHttpServer()).get('/whoami');

    expect(forged.text).toBe(plain.text);
    expect(forged.text).not.toBe('203.0.113.7');
  });

  it('cannot be walked past the trusted hop count', async () => {
    // Two entries, one trusted hop. Express skips the right-most — the one the
    // real proxy would have written — and stops. Everything further left is the
    // client's own text and must not be reached, however many it appends.
    app = await appTrusting(1);

    const response = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.7');

    expect(response.text).not.toBe('198.51.100.1');
    expect(response.text).toBe('203.0.113.7');
  });

  it('honours the header within the trusted hop count', async () => {
    // The other half of the pair: without this case, the two above would pass
    // just as well if `trust proxy` did nothing at all.
    app = await appTrusting(1);

    const response = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(response.text).toBe('203.0.113.7');
  });
});
