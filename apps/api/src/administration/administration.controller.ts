import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import { CreateServerDto } from './create-server.dto';
import type { Server } from './server-repository.interface';

/** The shape every server route returns — a `Server`, id serialised per AGENTS.md section 4. */
interface ServerResponse {
  id: string;
  name: string;
  iconUrl: string | null;
  channelCreationPolicy: Server['channelCreationPolicy'];
  memberInviteToggle: boolean;
  createdAt: string;
}

function toServerResponse(server: Server): ServerResponse {
  return {
    id: server.id.toString(),
    name: server.name,
    iconUrl: server.iconUrl,
    channelCreationPolicy: server.channelCreationPolicy,
    memberInviteToggle: server.memberInviteToggle,
    createdAt: server.createdAt.toISOString(),
  };
}

@Controller('servers')
@UseGuards(SessionAuthGuard)
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Post()
  @RateLimit('strict-mutation')
  async createServer(
    @CurrentUser() user: User,
    @Body() dto: CreateServerDto,
  ): Promise<ServerResponse> {
    const server = await this.administration.createServer(user.id, {
      name: dto.name,
      iconUrl: dto.iconUrl ?? null,
    });

    return toServerResponse(server);
  }

  @Get()
  @RateLimit('read')
  async listMyServers(@CurrentUser() user: User): Promise<ServerResponse[]> {
    const servers = await this.administration.listMyServers(user.id);

    return servers.map(toServerResponse);
  }

  @Get(':serverId')
  @RateLimit('read')
  async getServer(
    @CurrentUser() user: User,
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
  ): Promise<ServerResponse> {
    const server = await this.administration.getServer(serverId, user.id);

    return toServerResponse(server);
  }
}
