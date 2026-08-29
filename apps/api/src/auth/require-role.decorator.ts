import { SetMetadata } from '@nestjs/common';
import { Role } from '../administration/membership-repository.interface';

/** The `Reflector` key `RequireRoleGuard` reads the allowed roles back from. */
export const REQUIRE_ROLE_KEY = 'requireRole';

/**
 * Marks a route, or every route on a controller, as restricted to callers
 * whose membership in the server named by the `:serverId` route param holds
 * one of these roles.
 *
 * Typed against `Role` rather than `string`, so `@RequireRole('ownre')` is a
 * compile error rather than a silently-unenforced route (same reasoning as
 * `@RateLimit`, docs/architecture/auth-service.md section 7).
 *
 * An undecorated route makes no membership lookup at all — coverage is
 * opt-in, same as `@RateLimit`.
 */
export const RequireRole = (...roles: Role[]) =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);
