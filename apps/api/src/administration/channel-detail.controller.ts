import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { CurrentChannelCapabilities } from '../auth/current-channel-capabilities.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../auth/user-repository.interface';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import type { Capability } from './channel-override-repository.interface';
import { ChannelResponse, toChannelResponse } from './channel.controller';
import { UpdateChannelDto } from './update-channel.dto';

/**
 * The channel routes addressed by channel id rather than by server id.
 *
 * A separate controller from `ChannelController` because these carry no
 * `:serverId` param, so neither `RequireRoleGuard` nor
 * `RequireChannelCreationGuard` can apply to them — both read
 * `request.params.serverId`. `RequireCapabilityGuard` is what fills the gap:
 * it resolves the server from the channel itself. Same shape of reasoning as
 * `InviteController`'s own doc.
 */
@Controller('channels')
@UseGuards(SessionAuthGuard)
export class ChannelDetailController {
  constructor(private readonly administration: AdministrationService) {}

  /**
   * One channel's details.
   *
   * Every refusal here is a 404 rather than a 403 — see
   * `RequireCapabilityGuard`'s own doc. By the time the handler runs, the
   * guard has already established the caller may view this channel, so there
   * is no further check to make.
   */
  @Get(':channelId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('view')
  @RateLimit('read')
  async get(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @CurrentChannelCapabilities() myCapabilities: Capability[],
  ): Promise<ChannelResponse> {
    const channel = await this.administration.getChannel(channelId);

    return toChannelResponse(channel, myCapabilities);
  }

  /**
   * Renames a channel, or flips it between private and public.
   *
   * `manage_settings`, which a Member never holds server-wide, so PRD section
   * 5's "Make a channel private: Owner and Moderator only" is satisfied by
   * the guard rather than by a check in the handler. A Moderator whose
   * `manage_settings` has been revoked on this one channel is refused here
   * and still succeeds on its siblings — that is the override biting, and it
   * is the whole point of routing this through the guard.
   *
   * 200 rather than 204: the caller wants the updated channel back, and a
   * rename that returns nothing forces a second request to render the result.
   *
   * A duplicate name in the same server surfaces as a 409, straight from the
   * adapter's `UNIQUE (serverId, name)` mapping. Flipping private to public
   * keeps the channel's member list — see
   * `AdministrationService.updateChannel`.
   */
  @Patch(':channelId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  async update(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Body() dto: UpdateChannelDto,
    @CurrentUser() user: User,
  ): Promise<ChannelResponse> {
    // Passed straight through, as `updateServer` does: the DTO's shape is
    // `UpdateChannelInput`'s, and `whitelist: true` has already stripped
    // anything else off the body.
    const channel = await this.administration.updateChannel(channelId, dto);

    return toChannelResponse(
      channel,
      await this.administration.getChannelCapabilities(channel, user.id),
    );
  }

  /**
   * Hard-deletes a channel, consistent with server deletion
   * (administration-service.md section 2) — no soft delete, no grace period.
   * Its messages, members and overrides go with it through the schema
   * cascade; see `AdministrationService.deleteChannel` for why none of that
   * is written out in code here.
   */
  @Delete(':channelId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async remove(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
  ): Promise<void> {
    await this.administration.deleteChannel(channelId);
  }
}
