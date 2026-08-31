import {
  ChannelOverride,
  OverrideRole,
} from './channel-override-repository.interface';

/**
 * `A extends B`, as a type-level boolean.
 *
 * `Assert` then only accepts `true`, so a wrong answer is a compile error
 * rather than a runtime one. Both are exported because
 * `@typescript-eslint/no-unused-vars` is an error in this repo and an unused
 * local type alias trips it.
 */
type Extends<A, B> = A extends B ? true : false;
type Assert<T extends true> = T;

/**
 * The Owner is never overridable: authority is defined at the server level
 * and can never be overridden by a channel (PRD section 5, data-model.md
 * section 4.6). `OverrideRole` therefore has to *exclude* `'owner'`, so an
 * owner override is unrepresentable rather than merely rejected at runtime.
 *
 * If `OverrideRole` ever widens to include `'owner'` — or to `string`, which
 * would include it — this alias stops satisfying `Assert`'s `T extends true`
 * constraint and the file fails to compile. That failure is the test.
 */
export type OwnerIsNotAnOverrideRole = Assert<
  Extends<'owner', OverrideRole> extends false ? true : false
>;

/**
 * The positive half, and the reason the negative one above is not vacuous: if
 * someone broke `Extends` itself so that it always answered `false`, the
 * assertion above would still pass while proving nothing. This one would fail.
 */
export type ModeratorIsAnOverrideRole = Assert<
  Extends<'moderator', OverrideRole>
>;

describe('ChannelOverride', () => {
  it('cannot be constructed for an owner', () => {
    // The Owner is never overridable (PRD section 5), so 'owner' is not in
    // OverrideRole. The directive below IS the assertion, and an inverted
    // one: it errors the moment the line after it stops being an error. If
    // ChannelOverride ever accepted 'owner', TypeScript would report the
    // directive as unused and this file would fail to compile. AGENTS.md
    // section 4 permits @ts-expect-error with an explanation; the banned
    // `as never` would have switched the check off instead of testing it.
    //
    // The directive has to sit on the line immediately before the one
    // TypeScript reports -- which is the property, not the declaration.
    const ownerOverride: ChannelOverride = {
      channelId: 1n,
      // @ts-expect-error 'owner' is not an OverrideRole, by design
      role: 'owner',
      capability: 'view',
    };

    // Keeps the binding used. The proof is the directive above and the two
    // type aliases, not this line.
    expect(ownerOverride.role).toBe('owner');
  });

  it('can be constructed for the two overridable roles', () => {
    const moderator: ChannelOverride = {
      channelId: 1n,
      role: 'moderator',
      capability: 'delete_others',
    };
    const member: ChannelOverride = {
      channelId: 1n,
      role: 'member',
      capability: 'post',
    };

    expect([moderator.role, member.role]).toEqual(['moderator', 'member']);
  });
});
