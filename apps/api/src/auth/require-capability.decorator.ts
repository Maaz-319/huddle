import { SetMetadata } from '@nestjs/common';
import { Capability } from '../administration/channel-override-repository.interface';

/** The `Reflector` key `RequireCapabilityGuard` reads the capability back from. */
export const REQUIRE_CAPABILITY_KEY = 'requireCapability';

/**
 * Marks a route, or every route on a controller, as requiring one capability
 * in the channel named by the `:channelId` route param.
 *
 * Typed against `Capability` rather than `string`, so
 * `@RequireCapability('mange_settings')` is a compile error rather than a
 * silently-unenforced route (same reasoning as `@RequireRole` and
 * `@RateLimit`, docs/architecture/auth-service.md section 7).
 *
 * An undecorated route makes no lookup at all — coverage is opt-in, same as
 * `@RequireRole` and `@RateLimit`.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, capability);
