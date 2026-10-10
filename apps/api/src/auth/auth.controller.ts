import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
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
import { ParseSnowflakeArrayPipe } from '../common/parse-snowflake-array.pipe';
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

/**
 * Destroys the current session and clears its cookie — the one thing
 * `POST /auth/logout` and `DELETE /auth/me` both end with. `express-session`
 * sets no custom cookie `name` in `SessionMiddleware`, so this is its own
 * default, `connect.sid`.
 */
function endSession(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error as Error);
        return;
      }

      res.clearCookie('connect.sid');
      res.status(204).send();
      resolve();
    });
  });
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

  /**
   * Logs out this device/browser only — destroys the current session.
   * "Log out everywhere" stays a documented future enhancement
   * (auth-service.md section 5), unchanged by this route.
   */
  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @RateLimit('read')
  logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    return endSession(req, res);
  }

  /**
   * Soft-deletes the caller's account, then ends the current session.
   * `SessionAuthGuard` rejects any other live session for this user the next
   * time it is used — see the guard's own doc for why that needs no session
   * index.
   */
  @Delete('me')
  @UseGuards(SessionAuthGuard)
  @RateLimit('strict-mutation')
  async deleteMe(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.authService.markDeleted(user.id);
    await endSession(req, res);
  }

  /**
   * Bulk user lookup by ids. Used by the member sidebar to resolve usernames
   * and avatars for a server's member list.
   *
   * Returns users in the order requested. Users that don't exist (or are
   * deleted) are omitted from the result.
   */
  @Get('users')
  @UseGuards(SessionAuthGuard)
  @RateLimit('read')
  async getUsers(
    @Query('ids', ParseSnowflakeArrayPipe) ids: bigint[],
  ): Promise<MeResponse[]> {
    const users = await this.authService.findByIds(ids);
    return users.map(toMeResponse);
  }
}
