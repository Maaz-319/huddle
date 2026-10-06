import type { Capability } from '../administration/channel-override-repository.interface';
import { ForbiddenError, NotFoundError } from '../common/errors';
import type { CapabilityDecision } from './resolve-capability';

/**
 * The **refusal half** of `RequireCapabilityGuard`, extracted so the guard
 * and the socket path (#65's gateway) turn the same `resolveCapability`
 * decision into the same error. The rules live in `resolveCapability`; the
 * hiding rule — a refused `view`, a private channel, a non-member — is the
 * other half of the same policy, and two copies of *it* would drift exactly
 * as two copies of the rules would.
 *
 * The 404s are byte-identical on purpose (see the guard's own class doc for
 * why): a differing message or `details` would make a 404 an existence
 * oracle. `hiddenChannelError` is the one place that body is written.
 */
export function hiddenChannelError(channelId: string): NotFoundError {
  return new NotFoundError('Channel not found', { channelId });
}

/**
 * A `CapabilityDecision` that came back `allowed: false`, plus the
 * capability it was asked for and the channel id it was asked in.
 *
 * - `hidden` ⇒ 404, always — the private-channel rule.
 * - Any other refusal of `view` ⇒ 404 too: the channel listing filters a
 *   `view`-revoked channel out, so a 403 would confirm the existence of a
 *   channel the caller can never see listed.
 * - Any other refusal of a non-`view` capability ⇒ 403: by the time a caller
 *   is asking to post, they can already see the channel, so there is nothing
 *   left to hide.
 */
export function capabilityRefusalError(
  decision: Extract<CapabilityDecision, { allowed: false }>,
  capability: Capability,
  channelId: string,
): NotFoundError | ForbiddenError {
  switch (decision.reason) {
    case 'hidden':
      return hiddenChannelError(channelId);
    case 'role-default':
    case 'override':
      return capability === 'view'
        ? hiddenChannelError(channelId)
        : new ForbiddenError('Insufficient capability', { capability });
    default: {
      // A declaration, not a cast -- if CapabilityDecision grows a reason
      // this stops compiling. AGENTS.md section 4 bans `as never`; this is
      // the opposite of that, and the reason it looks similar.
      const unreachable: never = decision;

      return unreachable;
    }
  }
}
