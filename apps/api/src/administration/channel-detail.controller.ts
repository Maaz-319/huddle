import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import { ChannelResponse, toChannelResponse } from './channel.controller';

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
  ): Promise<ChannelResponse> {
    const channel = await this.administration.getChannel(channelId);

    return toChannelResponse(channel);
  }
}
