import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CAPABILITIES,
  ChannelOverrideParams,
  OVERRIDE_ROLES,
} from './channel-override.params';

const CHANNEL_ID = '300000000000000001';

function parse(params: Record<string, unknown>) {
  const dto = plainToInstance(ChannelOverrideParams, params, {
    enableImplicitConversion: false,
  });

  return { dto, errors: validateSync(dto) };
}

function failingProperties(params: Record<string, unknown>): string[] {
  return parse(params).errors.map((error) => error.property);
}

describe('ChannelOverrideParams', () => {
  it('accepts a valid triple and parses the id into a bigint', () => {
    const { dto, errors } = parse({
      channelId: CHANNEL_ID,
      role: 'moderator',
      capability: 'post',
    });

    expect(errors).toEqual([]);
    expect(dto.channelId).toBe(BigInt(CHANNEL_ID));
  });

  it.each(OVERRIDE_ROLES)('accepts the role %p', (role) => {
    expect(
      failingProperties({ channelId: CHANNEL_ID, role, capability: 'view' }),
    ).toEqual([]);
  });

  it.each(CAPABILITIES)('accepts the capability %p', (capability) => {
    expect(
      failingProperties({
        channelId: CHANNEL_ID,
        role: 'moderator',
        capability,
      }),
    ).toEqual([]);
  });

  it('rejects the owner role', () => {
    // The Owner is never overridable (PRD section 5). The port already makes
    // an owner override unrepresentable in TypeScript; this is the same rule
    // at the edge, where the value arrives as an untyped URL segment.
    expect(
      failingProperties({
        channelId: CHANNEL_ID,
        role: 'owner',
        capability: 'view',
      }),
    ).toEqual(['role']);
  });

  it.each([['admin'], ['Moderator'], [''], ['moderator '], ['1']])(
    'rejects the role %p',
    (role) => {
      expect(
        failingProperties({ channelId: CHANNEL_ID, role, capability: 'view' }),
      ).toEqual(['role']);
    },
  );

  it.each([['read'], ['View'], ['delete'], [''], ['manage-settings']])(
    'rejects the capability %p',
    (capability) => {
      expect(
        failingProperties({
          channelId: CHANNEL_ID,
          role: 'member',
          capability,
        }),
      ).toEqual(['capability']);
    },
  );

  it.each([['not-a-snowflake'], [''], ['-1'], ['1.5']])(
    'rejects the channel id %p',
    (channelId) => {
      expect(
        failingProperties({ channelId, role: 'member', capability: 'view' }),
      ).toEqual(['channelId']);
    },
  );

  it('reports every offending property at once', () => {
    expect(
      failingProperties({
        channelId: 'nope',
        role: 'owner',
        capability: 'read',
      }).sort(),
    ).toEqual(['capability', 'channelId', 'role']);
  });
});
