import { IsIn } from 'class-validator';
import { OVERRIDE_ROLES, type OverrideRole } from '@huddle/contracts';

/**
 * Body for `PATCH /servers/:serverId/members/:userId/role`. `'owner'` is
 * deliberately not a valid value here — see `MembershipRepository.updateRole`.
 */
export class UpdateMemberRoleDto {
  @IsIn(OVERRIDE_ROLES)
  role!: OverrideRole;
}
