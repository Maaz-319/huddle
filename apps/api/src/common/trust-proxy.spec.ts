import {
  Controller,
  Get,
  Ip,
  INestApplication,
  Req,
  Type,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureTrustProxy, resolveClientIp } from './trust-proxy';

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

/**
 * Hands back both addresses for the *same* request: `req.ip` as Express
 * resolved it, and `resolveClientIp` as the socket.io handshake would. The
 * parity claim is per-request, so a header the two parse differently shows
 * up as a mismatch rather than as two runs that happened to differ.
 */
function parityController(hops: number): Type<unknown> {
  @Controller()
  class ParityController {
    @Get('parity')
    parity(@Req() req: Request): {
      rest: string | undefined;
      handshake: string;
    } {
      return { rest: req.ip, handshake: resolveClientIp(req, hops) };
    }
  }

  return ParityController;
}

/** A running app trusting exactly `hops` proxies in front of it. */
async function appTrusting(
  hops: number,
  controllers: Type<unknown>[] = [WhoAmIController],
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers,
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

  describe('resolveClientIp', () => {
    /** One request, both answers — REST's `req.ip` and the WS handshake's. */
    async function bothAddresses(
      hops: number,
      forwardedFor?: string,
    ): Promise<{ rest: string | undefined; handshake: string }> {
      app = await appTrusting(hops, [parityController(hops)]);

      const call = request(app.getHttpServer()).get('/parity');
      const response = forwardedFor
        ? await call.set('X-Forwarded-For', forwardedFor)
        : await call;

      return response.body as { rest: string | undefined; handshake: string };
    }

    it('agrees with req.ip when no forwarded header is present', async () => {
      const { rest, handshake } = await bothAddresses(0);

      expect(handshake).toBe(rest);
      // The socket address itself, not a header-derived invention.
      expect(rest).toContain('127.0.0.1');
    });

    it('agrees with req.ip ignoring a forged entry at zero hops', async () => {
      const { rest, handshake } = await bothAddresses(0, '203.0.113.7');

      expect(handshake).toBe(rest);
      expect(handshake).not.toBe('203.0.113.7');
    });

    it('agrees with req.ip honouring a header within one trusted hop', async () => {
      const { rest, handshake } = await bothAddresses(1, '203.0.113.7');

      expect(handshake).toBe('203.0.113.7');
      expect(handshake).toBe(rest);
    });

    it('agrees with req.ip when the chain is longer than the trusted hop count', async () => {
      const { rest, handshake } = await bothAddresses(
        1,
        '198.51.100.1, 203.0.113.7',
      );

      // The right-most entry within the hop count; the left one is the
      // client's own text and must not be reached — for the handshake too.
      expect(handshake).toBe('203.0.113.7');
      expect(handshake).toBe(rest);
    });
  });
});
