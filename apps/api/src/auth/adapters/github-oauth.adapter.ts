import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, StrategyOptions } from 'passport-github2';
import { EnvironmentVariables } from '../../common/env.validation';
import { AuthService } from '../auth.service';
import { User, UserProfile } from '../user-repository.interface';

/**
 * The only file allowed to import `passport-github2` (AGENTS.md section 2 —
 * a third-party client lives behind an adapter, same boundary
 * `PrismaUserRepository` demonstrates for Postgres).
 *
 * `state: true` backs the CSRF protection on the OAuth redirect
 * (docs/architecture/auth-service.md section 2) and relies on the session
 * middleware from `auth.module.ts` already being active — Passport stores the
 * state value in `req.session`.
 *
 * The access/refresh token passed into `validate` is used once, to fetch the
 * profile Passport already resolved, and is never persisted anywhere.
 */
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly authService: AuthService,
  ) {
    const options: StrategyOptions = {
      clientID: config.get('GITHUB_CLIENT_ID', { infer: true }),
      clientSecret: config.get('GITHUB_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GITHUB_CALLBACK_URL', { infer: true }),
      scope: ['read:user', 'user:email'],
    };

    // passport-github2's own `StrategyOptions.state` type only allows
    // `string`, but at runtime (via passport-oauth2) `state: true` is what
    // switches on the built-in session-backed state store this relies on —
    // the type package hasn't caught up with that documented behavior. This
    // is the one field widened, not the whole options shape.
    (options as { state?: unknown }).state = true;

    super(options);
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<User> {
    const githubProfile: UserProfile = {
      githubId: profile.id,
      username: profile.username ?? profile.displayName,
      avatarUrl: profile.photos?.[0]?.value ?? '',
      email: profile.emails?.[0]?.value ?? '',
    };

    return this.authService.loginWithGithub(githubProfile);
  }
}
