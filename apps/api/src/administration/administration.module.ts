import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RequireRoleGuard } from '../auth/require-role.guard';
import { PrismaMembershipRepository } from './adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from './adapters/prisma-server-repository.adapter';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { MembershipRepository } from './membership-repository.interface';
import { ServerRepository } from './server-repository.interface';

/**
 * Servers and membership. `ServerRepository`/`MembershipRepository` are the
 * ports #36–#37 build the rest of server-level authority on top of.
 *
 * `RequireRoleGuard` lives in `src/auth/` (docs/architecture/auth-service.md
 * section 7 names it as the Auth Service's enforcement mechanism), but is
 * provided *here*, not by `AuthModule`: it depends on `MembershipRepository`,
 * which only this module binds, and `AuthModule` cannot import this module
 * back without a circular dependency (this module already imports
 * `AuthModule`, for `SessionAuthGuard`).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdministrationController],
  providers: [
    { provide: ServerRepository, useClass: PrismaServerRepository },
    { provide: MembershipRepository, useClass: PrismaMembershipRepository },
    AdministrationService,
    RequireRoleGuard,
  ],
  exports: [ServerRepository, MembershipRepository, RequireRoleGuard],
})
export class AdministrationModule {}
