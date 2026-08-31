import { SetMetadata } from '@nestjs/common';

/** The `Reflector` key `RequireChannelCreationGuard` reads back from. */
export const REQUIRE_CHANNEL_CREATION_KEY = 'requireChannelCreation';

/**
 * Marks a route as gated by the server's own channel-creation policy — the
 * `channelCreationPolicy` column on the server named by the `:serverId` route
 * param (administration-service.md section 3).
 *
 * Unlike `@RequireRole` and `@RateLimit` this takes no arguments, so there is
 * nothing here for the type system to catch. That is the point rather than an
 * omission: the set of roles allowed to create a channel is *per-server row
 * data*, read live on every request, not a static list a decorator could
 * carry. That is exactly why this cannot be expressed as `@RequireRole(...)`,
 * whose allowed roles are baked in at the call site.
 *
 * Coverage is opt-in, same as `@RequireRole` and `@RateLimit`: an undecorated
 * route makes no lookup at all.
 */
export const RequireChannelCreation = () =>
  SetMetadata(REQUIRE_CHANNEL_CREATION_KEY, true);
