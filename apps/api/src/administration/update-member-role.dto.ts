import { IsIn } from 'class-validator';
import { Role } from './membership-repository.interface';

const ASSIGNABLE_ROLES: Extract<Role, 'moderator' | 'member'>[] = [
  'moderator',
  'member',
];

/**
 * Body for `PATCH /servers/:serverId/members/:userId/role`. `'owner'` is
 * deliberately not a valid value here — see `MembershipRepository.updateRole`.
 */
export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: 'moderator' | 'member';
}
