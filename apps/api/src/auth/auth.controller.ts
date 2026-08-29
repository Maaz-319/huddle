import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { EnvironmentVariables } from '../common/env.validation';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { GithubAuthGuard } from './github-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { UpdateBioDto } from './update-bio.dto';
import type { User } from './user-repository.interface';

/** The shape `GET`/`PATCH /auth/me` return — a `User`, id serialised per AGENTS.md section 4. */
interface MeResponse {
  id: string;
  username: string;
  avatarUrl: string;
  email: string;
  bio: string | null;
}

function toMeResponse(user: User): MeResponse {
  return {
    id: user.id.toString(),
    username: user.username,
    avatarUrl: user.avatarUrl,
    email: user.email,
    bio: user.bio,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly authService: AuthService,
  ) {}

  /**
   * Passport's guard handles the redirect to GitHub's consent screen — this
   * handler body never runs.
   */
  @Get('github')
  @UseGuards(AuthGuard('github'))
  @RateLimit('auth-ip')
  githubLogin(): void {}

  /**
   * `req.user` is the `User` `GithubStrategy.validate` already
   * provisioned/synced. Sets the session and redirects to `WEB_ORIGIN` on
   * success; on denial or failure (`GithubAuthGuard` tolerates both rather
   * than throwing), redirects to `WEB_ORIGIN` with an error indicator instead
   * of Huddle's own JSON error shape, since there is no client here to read
   * it as JSON yet.
   */
  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  @RateLimit('auth-ip')
  githubCallback(@Req() req: Request, @Res() res: Response): void {
    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true });
    const user = req.user;

    if (user === undefined) {
      res.redirect(`${webOrigin}?error=oauth_failed`);
      return;
    }

    req.session.userId = user.id.toString();
    res.redirect(webOrigin);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @RateLimit('read')
  me(@CurrentUser() user: User): MeResponse {
    return toMeResponse(user);
  }

  /**
   * `bio` is optional in the body: an omitted field is a no-op (PATCH
   * semantics — nothing to change), while an explicit empty string is how a
   * caller clears it. `null` only ever comes from the port's own default on
   * first provisioning, never from this route.
   */
  @Patch('me')
  @UseGuards(SessionAuthGuard)
  @RateLimit('strict-mutation')
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateBioDto,
  ): Promise<MeResponse> {
    if (dto.bio === undefined) return toMeResponse(user);

    const updated = await this.authService.updateBio(user.id, dto.bio);
    return toMeResponse(updated);
  }
}
