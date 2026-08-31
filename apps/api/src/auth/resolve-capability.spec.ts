import {
  Capability,
  ChannelOverride,
} from '../administration/channel-override-repository.interface';
import { Role } from '../administration/membership-repository.interface';
import {
  CapabilityContext,
  DEFAULT_CAPABILITIES,
  resolveCapability,
} from './resolve-capability';

const CHANNEL_ID = 700000000000000001n;

/** The three shapes a channel can present to a caller. */
type Visibility = 'public' | 'private-member' | 'private-outsider';

/**
 * What the expectation table records. `'allow'` is the allowed case; the
 * other three are the `reason` on a refusal.
 */
type Expected = 'allow' | 'hidden' | 'role-default' | 'override';

/**
 * Every revocation this channel carries.
 *
 * `withOverride` revokes the capability under test for **both** overridable
 * roles, rather than only the role under test. That is what makes the owner
 * rows meaningful: an owner-targeted override is unconstructable by design
 * (see channel-override-repository.spec.ts), so the strongest thing the
 * matrix can assert about an owner is that a channel blanketed in
 * revocations still does not touch them.
 *
 * The cost is that the matrix cannot catch an override leaking across roles,
 * since every row has both roles revoked. That case is covered on its own,
 * below, under "does not let one role's override touch another role" -- and a
 * mutation check confirms it is the only test that catches it.
 */
function overridesFor(
  capability: Capability,
  withOverride: boolean,
): ChannelOverride[] {
  if (!withOverride) return [];

  return [
    { channelId: CHANNEL_ID, role: 'moderator', capability },
    { channelId: CHANNEL_ID, role: 'member', capability },
  ];
}

function contextFor(
  role: Role,
  visibility: Visibility,
  capability: Capability,
  withOverride: boolean,
): CapabilityContext {
  return {
    role,
    isPrivate: visibility !== 'public',
    isChannelMember: visibility === 'private-member',
    overrides: overridesFor(capability, withOverride),
  };
}

/**
 * The full matrix: 3 roles × 4 capabilities × 3 visibilities × 2 override
 * states = 72 rows.
 *
 * Every expectation is a literal a person wrote. Deriving them from a helper
 * would just be a second copy of `resolveCapability`, and the suite would
 * stay green if the real one were deleted — which AGENTS.md section 5 names
 * as the thing that is not a test.
 */
const MATRIX: [Role, Capability, Visibility, boolean, Expected][] = [
  // --- Owner: allowed in every single combination. Authority is a
  // server-level fact a channel can never touch (PRD section 5).
  ['owner', 'view', 'public', false, 'allow'],
  ['owner', 'view', 'public', true, 'allow'],
  ['owner', 'view', 'private-member', false, 'allow'],
  ['owner', 'view', 'private-member', true, 'allow'],
  ['owner', 'view', 'private-outsider', false, 'allow'],
  ['owner', 'view', 'private-outsider', true, 'allow'],
  ['owner', 'post', 'public', false, 'allow'],
  ['owner', 'post', 'public', true, 'allow'],
  ['owner', 'post', 'private-member', false, 'allow'],
  ['owner', 'post', 'private-member', true, 'allow'],
  ['owner', 'post', 'private-outsider', false, 'allow'],
  ['owner', 'post', 'private-outsider', true, 'allow'],
  ['owner', 'delete_others', 'public', false, 'allow'],
  ['owner', 'delete_others', 'public', true, 'allow'],
  ['owner', 'delete_others', 'private-member', false, 'allow'],
  ['owner', 'delete_others', 'private-member', true, 'allow'],
  ['owner', 'delete_others', 'private-outsider', false, 'allow'],
  ['owner', 'delete_others', 'private-outsider', true, 'allow'],
  ['owner', 'manage_settings', 'public', false, 'allow'],
  ['owner', 'manage_settings', 'public', true, 'allow'],
  ['owner', 'manage_settings', 'private-member', false, 'allow'],
  ['owner', 'manage_settings', 'private-member', true, 'allow'],
  ['owner', 'manage_settings', 'private-outsider', false, 'allow'],
  ['owner', 'manage_settings', 'private-outsider', true, 'allow'],

  // --- Moderator: all four by default, losing exactly the overridden one.
  // Hidden outranks everything except the owner bypass.
  ['moderator', 'view', 'public', false, 'allow'],
  ['moderator', 'view', 'public', true, 'override'],
  ['moderator', 'view', 'private-member', false, 'allow'],
  ['moderator', 'view', 'private-member', true, 'override'],
  ['moderator', 'view', 'private-outsider', false, 'hidden'],
  ['moderator', 'view', 'private-outsider', true, 'hidden'],
  ['moderator', 'post', 'public', false, 'allow'],
  ['moderator', 'post', 'public', true, 'override'],
  ['moderator', 'post', 'private-member', false, 'allow'],
  ['moderator', 'post', 'private-member', true, 'override'],
  ['moderator', 'post', 'private-outsider', false, 'hidden'],
  ['moderator', 'post', 'private-outsider', true, 'hidden'],
  ['moderator', 'delete_others', 'public', false, 'allow'],
  ['moderator', 'delete_others', 'public', true, 'override'],
  ['moderator', 'delete_others', 'private-member', false, 'allow'],
  ['moderator', 'delete_others', 'private-member', true, 'override'],
  ['moderator', 'delete_others', 'private-outsider', false, 'hidden'],
  ['moderator', 'delete_others', 'private-outsider', true, 'hidden'],
  ['moderator', 'manage_settings', 'public', false, 'allow'],
  ['moderator', 'manage_settings', 'public', true, 'override'],
  ['moderator', 'manage_settings', 'private-member', false, 'allow'],
  ['moderator', 'manage_settings', 'private-member', true, 'override'],
  ['moderator', 'manage_settings', 'private-outsider', false, 'hidden'],
  ['moderator', 'manage_settings', 'private-outsider', true, 'hidden'],

  // --- Member: view and post only. delete_others and manage_settings are
  // refused at the role default, with or without an override, everywhere.
  ['member', 'view', 'public', false, 'allow'],
  ['member', 'view', 'public', true, 'override'],
  ['member', 'view', 'private-member', false, 'allow'],
  ['member', 'view', 'private-member', true, 'override'],
  ['member', 'view', 'private-outsider', false, 'hidden'],
  ['member', 'view', 'private-outsider', true, 'hidden'],
  ['member', 'post', 'public', false, 'allow'],
  ['member', 'post', 'public', true, 'override'],
  ['member', 'post', 'private-member', false, 'allow'],
  ['member', 'post', 'private-member', true, 'override'],
  ['member', 'post', 'private-outsider', false, 'hidden'],
  ['member', 'post', 'private-outsider', true, 'hidden'],
  ['member', 'delete_others', 'public', false, 'role-default'],
  ['member', 'delete_others', 'public', true, 'role-default'],
  ['member', 'delete_others', 'private-member', false, 'role-default'],
  ['member', 'delete_others', 'private-member', true, 'role-default'],
  ['member', 'delete_others', 'private-outsider', false, 'hidden'],
  ['member', 'delete_others', 'private-outsider', true, 'hidden'],
  ['member', 'manage_settings', 'public', false, 'role-default'],
  ['member', 'manage_settings', 'public', true, 'role-default'],
  ['member', 'manage_settings', 'private-member', false, 'role-default'],
  ['member', 'manage_settings', 'private-member', true, 'role-default'],
  ['member', 'manage_settings', 'private-outsider', false, 'hidden'],
  ['member', 'manage_settings', 'private-outsider', true, 'hidden'],
];

describe('resolveCapability', () => {
  it('covers every combination exactly once', () => {
    // 3 roles x 4 capabilities x 3 visibilities x 2 override states. Guards
    // the table itself against a dropped or duplicated row -- the failure
    // mode a hand-written matrix actually has.
    expect(MATRIX).toHaveLength(72);
    expect(new Set(MATRIX.map((row) => row.slice(0, 4).join('|'))).size).toBe(
      72,
    );
  });

  describe('the matrix', () => {
    it.each(MATRIX)(
      'a %s asking for %s in a %s channel, override=%s => %s',
      (role, capability, visibility, withOverride, expected) => {
        const decision = resolveCapability(
          contextFor(role, visibility, capability, withOverride),
          capability,
        );

        if (expected === 'allow') {
          expect(decision).toEqual({ allowed: true });
        } else {
          expect(decision).toEqual({ allowed: false, reason: expected });
        }
      },
    );
  });

  describe('the rules the matrix exists to protect', () => {
    it('lets the owner through a private channel they hold no row in, blanketed in overrides', () => {
      const decision = resolveCapability(
        {
          role: 'owner',
          isPrivate: true,
          isChannelMember: false,
          overrides: [
            {
              channelId: CHANNEL_ID,
              role: 'moderator',
              capability: 'manage_settings',
            },
            {
              channelId: CHANNEL_ID,
              role: 'member',
              capability: 'manage_settings',
            },
          ],
        },
        'manage_settings',
      );

      expect(decision).toEqual({ allowed: true });
    });

    it('never consults membership or overrides for an owner', () => {
      // A context whose other fields all say "refuse". If the owner check
      // were not first, one of them would win.
      const decision = resolveCapability(
        {
          role: 'owner',
          isPrivate: true,
          isChannelMember: false,
          overrides: [
            { channelId: CHANNEL_ID, role: 'member', capability: 'view' },
          ],
        },
        'view',
      );

      expect(decision).toEqual({ allowed: true });
    });

    it('hides, rather than forbids, a private channel from a server member who is not in it', () => {
      const decision = resolveCapability(
        contextFor('member', 'private-outsider', 'view', false),
        'view',
      );

      // This is the difference between "hidden" and "forbidden", and it is
      // the whole reason the decision is not a boolean.
      expect(decision).toEqual({ allowed: false, reason: 'hidden' });
    });

    it('refuses a member delete_others and manage_settings in every configuration', () => {
      const visibilities: Visibility[] = [
        'public',
        'private-member',
        'private-outsider',
      ];

      for (const capability of ['delete_others', 'manage_settings'] as const) {
        for (const visibility of visibilities) {
          for (const withOverride of [false, true]) {
            const decision = resolveCapability(
              contextFor('member', visibility, capability, withOverride),
              capability,
            );

            expect(decision.allowed).toBe(false);
          }
        }
      }
    });

    it('takes exactly one capability off a moderator per override, leaving the other three', () => {
      const overrides: ChannelOverride[] = [
        { channelId: CHANNEL_ID, role: 'moderator', capability: 'post' },
      ];
      const context: CapabilityContext = {
        role: 'moderator',
        isPrivate: false,
        isChannelMember: false,
        overrides,
      };

      expect(resolveCapability(context, 'post')).toEqual({
        allowed: false,
        reason: 'override',
      });
      for (const kept of [
        'view',
        'delete_others',
        'manage_settings',
      ] as const) {
        expect(resolveCapability(context, kept)).toEqual({ allowed: true });
      }
    });

    it('does not let one role’s override touch another role', () => {
      const overrides: ChannelOverride[] = [
        { channelId: CHANNEL_ID, role: 'member', capability: 'post' },
      ];

      expect(
        resolveCapability(
          {
            role: 'moderator',
            isPrivate: false,
            isChannelMember: false,
            overrides,
          },
          'post',
        ),
      ).toEqual({ allowed: true });
      expect(
        resolveCapability(
          {
            role: 'member',
            isPrivate: false,
            isChannelMember: false,
            overrides,
          },
          'post',
        ),
      ).toEqual({ allowed: false, reason: 'override' });
    });

    it('never grants a capability the role lacks server-wide, whatever the overrides say', () => {
      // The tighten-only rule stated as its own case: there is no override
      // shape that adds anything, so an empty override list is the most
      // permissive one there is.
      for (const capability of ['delete_others', 'manage_settings'] as const) {
        expect(
          resolveCapability(
            {
              role: 'member',
              isPrivate: false,
              isChannelMember: false,
              overrides: [],
            },
            capability,
          ),
        ).toEqual({ allowed: false, reason: 'role-default' });
      }
    });
  });

  describe('DEFAULT_CAPABILITIES', () => {
    it('matches the matrix in administration-service.md section 4', () => {
      expect(DEFAULT_CAPABILITIES.owner).toEqual([
        'view',
        'post',
        'delete_others',
        'manage_settings',
      ]);
      expect(DEFAULT_CAPABILITIES.moderator).toEqual([
        'view',
        'post',
        'delete_others',
        'manage_settings',
      ]);
      expect(DEFAULT_CAPABILITIES.member).toEqual(['view', 'post']);
    });
  });
});
