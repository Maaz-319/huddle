import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaMembershipRepository } from './adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from './adapters/prisma-server-repository.adapter';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { MembershipRepository } from './membership-repository.interface';
import { ServerRepository } from './server-repository.interface';

/**
 * Servers and membership. `ServerRepository`/`MembershipRepository` are the
 * ports #35–#37 build the rest of server-level authority on top of.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdministrationController],
  providers: [
    { provide: ServerRepository, useClass: PrismaServerRepository },
    { provide: MembershipRepository, useClass: PrismaMembershipRepository },
    AdministrationService,
  ],
  exports: [ServerRepository, MembershipRepository],
})
export class AdministrationModule {}
