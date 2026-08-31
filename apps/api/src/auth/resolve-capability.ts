import {
  Capability,
  ChannelOverride,
} from '../administration/channel-override-repository.interface';
import { Role } from '../administration/membership-repository.interface';

/**
 * What a role holds in a channel before any override tightens it —
 * administration-service.md section 4, PRD section 5.
 *
 * Exported so the doc's matrix and the code are one artifact rather than two
 * that can drift.
 *
 * The Owner's row is a formality: `resolveCapability` never reads it, because
 * an owner short-circuits before any of this. It is listed anyway so the
 * table is the whole matrix a reader is looking for.
 */
export const DEFAULT_CAPABILITIES: Readonly<
  Record<Role, readonly Capability[]>
> = {
  owner: ['view', 'post', 'delete_others', 'manage_settings'],
  moderator: ['view', 'post', 'delete_others', 'manage_settings'],
  member: ['view', 'post'],
};

/** Everything the rules need. No I/O — the guard does the loading. */
export interface CapabilityContext {
  /** The caller's role in the channel's *server*. */
  role: Role;
  isPrivate: boolean;
  /** Whether the caller holds a `ChannelMember` row. Meaningless when public. */
  isChannelMember: boolean;
  /** This channel's revocations, across both overridable roles. */
  overrides: readonly ChannelOverride[];
}

/**
 * Why a capability was refused.
 *
 * `'hidden'` is separate from the other two because it is the difference
 * between "forbidden" and "does not exist as far as you are concerned", and
 * that difference is a 404 rather than a 403. A plain boolean would collapse
 * it and force the caller to re-derive the private-channel rule — a second
 * copy of a permission rule, which is exactly what this function exists to
 * prevent.
 */
export type CapabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: 'hidden' }
  | { allowed: false; reason: 'role-default' }
  | { allowed: false; reason: 'override' };

const ALLOWED: CapabilityDecision = { allowed: true };

/**
 * The whole of the effective-capability rule, as a pure function.
 *
 * Extracted from the guard so the guard and #54's view-filtered channel
 * listing decide the same way. Two copies of a permission rule is how they
 * drift.
 *
 * The order, from #51:
 *
 * 1. **Owner ⇒ allowed, unconditionally.** Authority is defined at the server
 *    level and can never be overridden by a channel (PRD section 5), so an
 *    owner needs no `ChannelMember` row and no override lookup — a channel
 *    cannot lock an owner out of their own server. Returns before either is
 *    consulted.
 * 2. **Private, and no `ChannelMember` row ⇒ hidden.** A private channel is
 *    *fully hidden* from non-members (administration-service.md section 3), so
 *    this is a 404; a 403 would confirm the channel exists, which is exactly
 *    what "fully hidden" rules out.
 * 3. **Outside the role's server-wide default ⇒ refused.** A Member never
 *    holds `delete_others` or `manage_settings`, anywhere.
 * 4. **An override row for `(role, capability)` ⇒ refused.** The row's
 *    existence *is* the revocation (data-model.md section 4.6).
 * 5. Otherwise allowed.
 *
 * Steps 3 and 4 together are the tighten-only rule at read time: an override
 * can subtract from the default, and there is no step anywhere that adds to
 * it.
 *
 * Note the ordering of 3 before 4 is not observable from outside — a Member
 * with a `delete_others` override is refused at step 3 and never reaches step
 * 4, and both refusals render identically. It is visible only in `reason`.
 */
export function resolveCapability(
  context: CapabilityContext,
  capability: Capability,
): CapabilityDecision {
  if (context.role === 'owner') return ALLOWED;

  if (context.isPrivate && !context.isChannelMember) {
    return { allowed: false, reason: 'hidden' };
  }

  if (!DEFAULT_CAPABILITIES[context.role].includes(capability)) {
    return { allowed: false, reason: 'role-default' };
  }

  const revoked = context.overrides.some(
    (override) =>
      override.role === context.role && override.capability === capability,
  );

  if (revoked) return { allowed: false, reason: 'override' };

  return ALLOWED;
}
