import { buildRateLimitKey } from './rate-limit-key';

const IP = '203.0.113.7';
const USER_ID = 8901234567890123n;
const CHANNEL_ID = 1234567890123456n;

describe('buildRateLimitKey', () => {
  it('builds the huddle:rl:<policy>:<dimension>:<id> scheme', () => {
    expect(
      buildRateLimitKey('message-send', { ip: IP, channelId: CHANNEL_ID }),
    ).toBe(`huddle:rl:message-send:channel:${CHANNEL_ID}`);
  });

  it('keys a per-user policy on the caller once one is resolved', () => {
    expect(buildRateLimitKey('read', { ip: IP, userId: USER_ID })).toBe(
      `huddle:rl:read:user:${USER_ID}`,
    );
  });

  it('keys a per-IP policy on the address, ignoring any caller present', () => {
    expect(buildRateLimitKey('auth-ip', { ip: IP, userId: USER_ID })).toBe(
      `huddle:rl:auth-ip:ip:${IP}`,
    );
  });

  it('falls back to an IP-keyed bucket when a per-user policy has no caller', () => {
    // Temporary, until Phase 3 resolves identity. The point is that it is a
    // real bucket: the alternative failure mode is an unlimited route.
    const key = buildRateLimitKey('strict-mutation', { ip: IP });

    expect(key).toBe(`huddle:rl:strict-mutation:ip:${IP}`);
  });

  it('separates two callers on a per-user policy', () => {
    expect(buildRateLimitKey('read', { ip: IP, userId: USER_ID })).not.toBe(
      buildRateLimitKey('read', { ip: IP, userId: USER_ID + 1n }),
    );
  });

  it('separates two channels on a per-channel policy', () => {
    expect(
      buildRateLimitKey('message-send', { ip: IP, channelId: CHANNEL_ID }),
    ).not.toBe(
      buildRateLimitKey('message-send', { ip: IP, channelId: CHANNEL_ID + 1n }),
    );
  });

  it('gives one caller the same per-channel bucket from two addresses', () => {
    // The per-channel dimension caps the channel, not the connection. Changing
    // network must not hand anyone a fresh message-send budget.
    expect(
      buildRateLimitKey('message-send', { ip: IP, channelId: CHANNEL_ID }),
    ).toBe(
      buildRateLimitKey('message-send', {
        ip: '198.51.100.1',
        channelId: CHANNEL_ID,
      }),
    );
  });

  it('separates two policies sharing a dimension and an id', () => {
    expect(buildRateLimitKey('read', { ip: IP, userId: USER_ID })).not.toBe(
      buildRateLimitKey('strict-mutation', { ip: IP, userId: USER_ID }),
    );
  });

  it('throws when a per-channel policy is given no channel', () => {
    expect(() =>
      buildRateLimitKey('typing', { ip: IP, userId: USER_ID }),
    ).toThrow(/per-channel/);
  });

  it('throws rather than keying a bucket on an empty address', () => {
    expect(() => buildRateLimitKey('auth-ip', { ip: '' })).toThrow(/no ip/);
  });
});
