import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { EnvironmentVariables } from '../common/env.validation';
import { RateLimit } from '../rate-limiter/rate-limit.decorator';
import { GithubAuthGuard } from './github-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
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
}
