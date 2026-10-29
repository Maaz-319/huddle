import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import type { ChannelOverride } from './channel-override-repository.interface';
import { ChannelOverrideParams } from './channel-override.params';
import type { ChannelOverrideResponse } from '@huddle/contracts';

export type { ChannelOverrideResponse } from '@huddle/contracts';

function toChannelOverrideResponse(
  override: ChannelOverride,
): ChannelOverrideResponse {
  return {
    channelId: override.channelId.toString(),
    role: override.role,
    capability: override.capability,
  };
}

/**
 * The tighten-only override API.
 *
 * **There is no shape here that expresses a grant, and that is the design.**
 * `PUT` only ever creates a revocation row; the table has no value column, so
 * a row cannot say "allowed" (data-model.md section 4.6); `DELETE` removes a
 * tightening and hands the role back to its server-wide default rather than
 * raising it above one; and no endpoint's success widens anybody's
 * capability. The 400s the service raises close the remaining no-op cases —
 * but it is the *absence of a grant path* that makes "an override can only
 * tighten" (FR-13) structural rather than merely enforced.
 *
 * Every route is `@RequireCapability('manage_settings')`, so the Owner always
 * may, and a Moderator may on any channel where that capability has not been
 * revoked for `moderator`. PRD section 5 gives "apply channel-level
 * overrides" to both roles.
 *
 * A Moderator can therefore revoke `manage_settings` from `moderator` on a
 * channel, locking their peers and themselves out of its settings. That is
 * the intended consequence of the capability being a bundle, not a bug: the
 * Owner is never overridable, so there is always a way back.
 */
@Controller('channels')
@UseGuards(SessionAuthGuard)
export class ChannelOverrideController {
  constructor(private readonly administration: AdministrationService) {}

  @Get(':channelId/overrides')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('read')
  async list(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
  ): Promise<ChannelOverrideResponse[]> {
    const overrides = await this.administration.listChannelOverrides(channelId);

    return overrides.map(toChannelOverrideResponse);
  }

  /**
   * Revokes a capability from a role in this channel.
   *
   * `PUT` rather than `POST`, because the operation is "make this pair
   * revoked": it names its own resource in the URL, it is idempotent, and a
   * second call is the same single row rather than a second one. There is no
   * body to post — the row is its own key.
   *
   * `params` carries the validated role and capability; `channelId` comes
   * through `ParseSnowflakePipe` as everywhere else. See
   * `ChannelOverrideParams` for why the class declares `channelId` too.
   */
  @Put(':channelId/overrides/:role/:capability')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async revoke(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Param() params: ChannelOverrideParams,
  ): Promise<void> {
    await this.administration.revokeCapability(
      channelId,
      params.role,
      params.capability,
    );
  }

  /**
   * Removes a revocation. Idempotent — restoring a pair that was never
   * revoked is a 204, not a 404, because the caller asked for an end state
   * that already holds.
   */
  @Delete(':channelId/overrides/:role/:capability')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async restore(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Param() params: ChannelOverrideParams,
  ): Promise<void> {
    await this.administration.restoreCapability(
      channelId,
      params.role,
      params.capability,
    );
  }
}
