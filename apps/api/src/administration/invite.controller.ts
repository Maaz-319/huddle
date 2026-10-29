import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { User } from '../auth/user-repository.interface';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AdministrationService } from './administration.service';
import { ParseInviteCodePipe } from './parse-invite-code.pipe';
import type { Server } from './server-repository.interface';
import type { InvitePreviewResponse } from '@huddle/contracts';

/**
 * What a code holder learns about a server before joining it.
 *
 * Deliberately minimal: no member count, no channel list, no owner. Someone
 * holding a code is not yet a member, and should learn only enough to decide
 * whether to accept.
 */
function toPreviewResponse(server: Server): InvitePreviewResponse {
  return {
    server: {
      id: server.id.toString(),
      name: server.name,
      iconUrl: server.iconUrl,
    },
  };
}

/**
 * The two routes addressed by invite code rather than by server id.
 *
 * A separate controller from `AdministrationController` because neither route
 * carries a `:serverId` param, so `RequireRoleGuard` cannot apply to them —
 * and must not, since the whole point is that the caller is *not* yet a
 * member. `SessionAuthGuard` still does: joining needs an identity, and the
 * preview is not public.
 */
@Controller('invites')
@UseGuards(SessionAuthGuard)
export class InviteController {
  constructor(private readonly administration: AdministrationService) {}

  @Get(':code')
  @RateLimit('read')
  async preview(
    @Param('code', ParseInviteCodePipe) code: string,
  ): Promise<InvitePreviewResponse> {
    const server = await this.administration.previewInvite(code);

    return toPreviewResponse(server);
  }

  /**
   * 200 rather than Nest's POST default of 201, and 200 again on a repeat
   * join: seating an already-seated user creates nothing, and the route must
   * never surface a 409 for a double-clicked button.
   */
  @Post(':code/join')
  @RateLimit('strict-mutation')
  @HttpCode(200)
  async join(
    @CurrentUser() user: User,
    @Param('code', ParseInviteCodePipe) code: string,
  ): Promise<InvitePreviewResponse> {
    const server = await this.administration.joinByCode(code, user.id);

    return toPreviewResponse(server);
  }
}
