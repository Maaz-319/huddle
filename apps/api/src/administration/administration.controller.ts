import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireRole } from '../auth/require-role.decorator';
import { RequireRoleGuard } from '../auth/require-role.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { ParseSnowflakePipe } from '../common/parse-snowflake.pipe';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import { CreateServerDto } from './create-server.dto';
import type { Membership } from './membership-repository.interface';
import type { Server } from './server-repository.interface';
import { TransferOwnershipDto } from './transfer-ownership.dto';
import { UpdateMemberRoleDto } from './update-member-role.dto';
import { UpdateServerDto } from './update-server.dto';

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

/** The shape a membership-role change returns — id serialised per AGENTS.md section 4. */
interface MembershipResponse {
  userId: string;
  role: Membership['role'];
  joinedAt: string;
}

function toMembershipResponse(membership: Membership): MembershipResponse {
  return {
    userId: membership.userId.toString(),
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
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

  @Patch(':serverId')
  @UseGuards(RequireRoleGuard)
  @RequireRole('owner')
  @RateLimit('strict-mutation')
  async updateServer(
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
    @Body() dto: UpdateServerDto,
  ): Promise<ServerResponse> {
    const server = await this.administration.updateServer(serverId, dto);

    return toServerResponse(server);
  }

  @Delete(':serverId')
  @UseGuards(RequireRoleGuard)
  @RequireRole('owner')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async deleteServer(
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
  ): Promise<void> {
    await this.administration.deleteServer(serverId);
  }

  @Patch(':serverId/members/:userId/role')
  @UseGuards(RequireRoleGuard)
  @RequireRole('owner')
  @RateLimit('strict-mutation')
  async updateMemberRole(
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
    @Param('userId', ParseSnowflakePipe) userId: bigint,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<MembershipResponse> {
    const membership = await this.administration.updateMemberRole(
      serverId,
      userId,
      dto.role,
    );

    return toMembershipResponse(membership);
  }

  @Post(':serverId/transfer-ownership')
  @UseGuards(RequireRoleGuard)
  @RequireRole('owner')
  @RateLimit('strict-mutation')
  @HttpCode(204)
  async transferOwnership(
    @CurrentUser() user: User,
    @Param('serverId', ParseSnowflakePipe) serverId: bigint,
    @Body() dto: TransferOwnershipDto,
  ): Promise<void> {
    await this.administration.transferOwnership(
      serverId,
      user.id,
      dto.toUserId,
    );
  }
}
