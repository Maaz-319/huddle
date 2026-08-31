import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { RequireChannelCreationGuard } from '../auth/require-channel-creation.guard';
import { RequireRoleGuard } from '../auth/require-role.guard';
import { PrismaChannelMemberRepository } from './adapters/prisma-channel-member-repository.adapter';
import { PrismaChannelOverrideRepository } from './adapters/prisma-channel-override-repository.adapter';
import { PrismaChannelRepository } from './adapters/prisma-channel-repository.adapter';
import { PrismaInviteRepository } from './adapters/prisma-invite-repository.adapter';
import { PrismaMembershipRepository } from './adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from './adapters/prisma-server-repository.adapter';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { ChannelDetailController } from './channel-detail.controller';
import { ChannelMemberController } from './channel-member.controller';
import { ChannelController } from './channel.controller';
import { ChannelMemberRepository } from './channel-member-repository.interface';
import { ChannelOverrideController } from './channel-override.controller';
import { ChannelOverrideRepository } from './channel-override-repository.interface';
import { ChannelRepository } from './channel-repository.interface';
import { InviteController } from './invite.controller';
import { InviteRepository } from './invite-repository.interface';
import { MembershipRepository } from './membership-repository.interface';
import { ServerRepository } from './server-repository.interface';

/**
 * Servers, membership, invites, and channels. `ServerRepository`/
 * `MembershipRepository` are the ports #36–#37 build server-level authority
 * on top of; `InviteRepository` is what #46–#48 build joining on top of;
 * `ChannelRepository` is what the channel routes build on, with
 * `ChannelMemberRepository` and `ChannelOverrideRepository` holding the two
 * halves of per-channel permission data that `@RequireCapability` reads.
 *
 * `RequireRoleGuard` lives in `src/auth/` (docs/architecture/auth-service.md
 * section 7 names it as the Auth Service's enforcement mechanism), but is
 * provided *here*, not by `AuthModule`: it depends on `MembershipRepository`,
 * which only this module binds, and `AuthModule` cannot import this module
 * back without a circular dependency (this module already imports
 * `AuthModule`, for `SessionAuthGuard`).
 *
 * `RequireChannelCreationGuard` and `RequireCapabilityGuard` are the same
 * case, on the same ports plus `ServerRepository` and the two channel ones.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AdministrationController,
    InviteController,
    ChannelController,
    ChannelDetailController,
    ChannelMemberController,
    ChannelOverrideController,
  ],
  providers: [
    { provide: ServerRepository, useClass: PrismaServerRepository },
    { provide: MembershipRepository, useClass: PrismaMembershipRepository },
    { provide: InviteRepository, useClass: PrismaInviteRepository },
    { provide: ChannelRepository, useClass: PrismaChannelRepository },
    {
      provide: ChannelMemberRepository,
      useClass: PrismaChannelMemberRepository,
    },
    {
      provide: ChannelOverrideRepository,
      useClass: PrismaChannelOverrideRepository,
    },
    AdministrationService,
    RequireRoleGuard,
    RequireChannelCreationGuard,
    RequireCapabilityGuard,
  ],
  exports: [
    ServerRepository,
    MembershipRepository,
    InviteRepository,
    ChannelRepository,
    ChannelMemberRepository,
    ChannelOverrideRepository,
    RequireRoleGuard,
  ],
})
export class AdministrationModule {}
