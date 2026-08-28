/**
 * Teaches Express how many reverse-proxy hops sit in front of the app, so that
 * `req.ip` is the client's address rather than the proxy's.
 *
 * This matters for exactly one thing today: the rate limiter's per-IP
 * dimension. Behind Render's TLS terminator every request arrives from the
 * proxy's address, so without this every caller shares one bucket and
 * rate-limits each other (docs/architecture/rate-limiter.md section 3).
 *
 * `hops` is a count and never `true`. With `true`, Express walks
 * `X-Forwarded-For` all the way to the left-most entry — which the client
 * wrote. Any caller could then put a fresh random address there on every
 * request and never share a bucket with itself. A count makes Express skip
 * exactly that many entries from the right, and everything further left is the
 * client's own text, ignored.
 *
 * It lives here as a function, rather than inline in `main.ts`, because
 * `main.ts` never runs under test and this is the piece whose failure mode is
 * silent: a wrong hop count still serves traffic, it just limits the wrong
 * thing.
 */
export interface TrustProxyConfigurable {
  set(setting: 'trust proxy', value: number): unknown;
}

export function configureTrustProxy(
  app: TrustProxyConfigurable,
  hops: number,
): void {
  app.set('trust proxy', hops);
}
