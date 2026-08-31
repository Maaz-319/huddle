import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireChannelCreation } from '../auth/require-channel-creation.decorator';
import { RequireChannelCreationGuard } from '../auth/require-channel-creation.guard';
import { RequireRole } from '../auth/require-role.decorator';
import { RequireRoleGuard } from '../auth/require-role.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import type { Channel } from './channel-repository.interface';
import { CreateChannelDto } from './create-channel.dto';

/** The shape every channel route returns — a `Channel`, ids serialised per AGENTS.md section 4. */
export interface ChannelResponse {
  id: string;
  serverId: string;
  name: string;
  isPrivate: boolean;
  createdAt: string;
}

/**
 * Exported, unlike the mappers on the other controllers, because
 * `ChannelDetailController` returns the same shape from `/channels/:channelId`
 * and two copies of a response shape is how they drift.
 */
export function toChannelResponse(channel: Channel): ChannelResponse {
  return {
    id: channel.id.toString(),
    serverId: channel.serverId.toString(),
    name: channel.name,
    isPrivate: channel.isPrivate,
    createdAt: channel.createdAt.toISOString(),
  };
}

/** The channel routes scoped to a server. */
@Controller('servers/:serverId/channels')
@UseGuards(SessionAuthGuard)
export class ChannelController {
  constructor(private readonly administration: AdministrationService) {}

  /**
   * Creates a channel. 201 is Nest's default for `@Post` and is the right
   * answer here deliberately: this mints a real resource at a new id.
   *
   * Who may call this is the server's own `channelCreationPolicy`, which is
   * per-server row data — hence `RequireChannelCreationGuard` rather than
   * `@RequireRole`, whose allowed roles are baked in at the call site.
   *
   * Whether the *created* channel may be private is a second question the
   * guard cannot answer, because it never sees the body — see
   * `AdministrationService.createChannel`.
   */
  @Post()
  @UseGuards(RequireChannelCreationGuard)
  @RequireChannelCreation()
  @RateLimit('strict-mutation')
  async create(
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
    @Body() dto: CreateChannelDto,
    @CurrentUser() user: User,
  ): Promise<ChannelResponse> {
    const channel = await this.administration.createChannel(
      {
        serverId,
        name: dto.name,
        isPrivate: dto.isPrivate,
      },
      user.id,
    );

    return toChannelResponse(channel);
  }

  /**
   * The server's channels, as this caller may see them.
   *
   * Private channels the caller is not in are dropped — see
   * `AdministrationService.listChannels`, which also records what is *not*
   * filtered yet: a `view` capability revoked by a `ChannelOverride` still
   * leaves the channel in this list, and #54 is where that lands.
   *
   * Listing all three roles on `@RequireRole` is not redundant; it is what
   * buys the 403-vs-404 disambiguation, for the reason already written on
   * `AdministrationController.getInvite`.
   */
  @Get()
  @UseGuards(RequireRoleGuard)
  @RequireRole('owner', 'moderator', 'member')
  @RateLimit('read')
  async list(
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
    @CurrentUser() user: User,
  ): Promise<ChannelResponse[]> {
    const channels = await this.administration.listChannels(serverId, user.id);

    return channels.map(toChannelResponse);
  }
}
