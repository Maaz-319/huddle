import { IsIn } from 'class-validator';
import {
  IsSnowflake,
  TransformSnowflake,
} from '../common/is-snowflake.decorator';
import type {
  Capability,
  OverrideRole,
} from './channel-override-repository.interface';

/**
 * The two overridable roles, as a runtime list.
 *
 * Typed `OverrideRole[]`, so adding `'owner'` here is a compile error rather
 * than a runtime widening of the rule. The Owner is never overridable (PRD
 * section 5), and `ChannelOverrideRepository` already excludes `'owner'` at
 * the type level — this array is the runtime half of that same rule, exactly
 * as `UpdateMemberRoleDto`'s `ASSIGNABLE_ROLES` is for
 * `MembershipRepository.updateRole`.
 */
export const OVERRIDE_ROLES: OverrideRole[] = ['moderator', 'member'];

/** The four capabilities — administration-service.md section 4. */
export const CAPABILITIES: Capability[] = [
  'view',
  'post',
  'delete_others',
  'manage_settings',
];

/**
 * The `:channelId/:role/:capability` triple the two override mutation routes
 * address, validated before the handler runs.
 *
 * **`channelId` is declared here even though the mutation handlers read the
 * role and capability off it and take the channel id through
 * `ParseSnowflakePipe` separately.** The global `ValidationPipe` runs with
 * `forbidNonWhitelisted: true`, and a keyless `@Param()` hands it *every*
 * route param — so leaving `channelId` out would make it an unexpected
 * property and turn every request to these routes into a 400. It looks like
 * dead code and is not.
 */
export class ChannelOverrideParams {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;

  @IsIn(OVERRIDE_ROLES)
  role!: OverrideRole;

  @IsIn(CAPABILITIES)
  capability!: Capability;
}
