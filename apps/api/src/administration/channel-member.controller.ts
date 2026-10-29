import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AddChannelMemberDto } from './add-channel-member.dto';
import { AdministrationService } from './administration.service';
import type { ChannelMember } from './channel-member-repository.interface';
import type { ChannelMemberResponse } from '@huddle/contracts';

export type { ChannelMemberResponse } from '@huddle/contracts';

function toChannelMemberResponse(member: ChannelMember): ChannelMemberResponse {
  return {
    channelId: member.channelId.toString(),
    userId: member.userId.toString(),
    addedAt: member.addedAt.toISOString(),
  };
}

/**
 * Who is in a private channel.
 *
 * Its own controller rather than more routes on `ChannelDetailController`,
 * which keeps each controller's doc about one thing; Nest is happy to have
 * several controllers share the `channels` prefix.
 *
 * Every route here is `manage_settings`, not `view`
 * (administration-service.md section 4 puts add/remove in the manage-settings
 * bundle), so a Member is refused on all three however the client is
 * tampered with — they never hold that capability anywhere in the server.
 */
@Controller('channels')
@UseGuards(SessionAuthGuard)
export class ChannelMemberController {
  constructor(private readonly administration: AdministrationService) {}

  /** A public channel answers with an empty list — see the service's own doc. */
  @Get(':channelId/members')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('read')
  async list(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
  ): Promise<ChannelMemberResponse[]> {
    const members = await this.administration.listChannelMembers(channelId);

    return members.map(toChannelMemberResponse);
  }

  /**
   * Seats a user in a private channel.
   *
   * 200 rather than Nest's POST default of 201, because the route is
   * idempotent: re-adding someone returns their existing row and creates
   * nothing, and a 201 there would claim a resource had been created when it
   * had not. Same reasoning as `AdministrationController.regenerateInvite`.
   *
   * A user outside the channel's server, or any user on a public channel, is
   * a 400 — see `AdministrationService.addChannelMember`.
   */
  @Post(':channelId/members')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  @HttpCode(200)
  async add(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Body() dto: AddChannelMemberDto,
  ): Promise<ChannelMemberResponse> {
    const member = await this.administration.addChannelMember(
      channelId,
      dto.userId,
    );

    return toChannelMemberResponse(member);
  }

  /**
   * Removes a user from a private channel. Idempotent — removing someone who
   * is not there is a 204, because the caller asked for an end state that
   * already holds.
   */
  @Delete(':channelId/members/:userId')
  @UseGuards(RequireCapabilityGuard)
  @RequireCapability('manage_settings')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async remove(
    @Param('channelId', ParseSnowflakePipe) channelId: bigint,
    @Param('userId', ParseSnowflakePipe) userId: bigint,
  ): Promise<void> {
    await this.administration.removeChannelMember(channelId, userId);
  }
}
