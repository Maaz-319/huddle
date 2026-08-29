import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { GithubStrategy } from './adapters/github-oauth.adapter';
import { PrismaUserRepository } from './adapters/prisma-user-repository.adapter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionMiddleware } from './session.middleware';
import { UserRepository } from './user-repository.interface';

/**
 * Identity and sessions. Phase 1 delivered only the persistence seam: the
 * `UserRepository` port and its Prisma adapter, the reference port/adapter
 * pair every later module copies. Phase 3 adds the OAuth flow above it:
 * `AuthService` (business logic, depends only on the port), the
 * `GithubStrategy` adapter (the only file allowed to import
 * `passport-github2`), `AuthController` (the two OAuth routes), and the
 * `express-session` middleware — a confirmed, documented exception to the
 * port/adapter convention (docs/architecture/auth-service.md section 3).
 *
 * The session middleware is wired here via `configure()`, not `main.ts`, so
 * it is active in e2e tests that build the app straight from `AppModule` and
 * never run `main.ts`.
 */
@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    { provide: UserRepository, useClass: PrismaUserRepository },
    AuthService,
    GithubStrategy,
  ],
  exports: [UserRepository],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes('*');
  }
}
