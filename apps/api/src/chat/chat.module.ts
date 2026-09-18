import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { AuthModule } from '../auth/auth.module';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { PrismaMessageRepository } from './adapters/prisma-message-repository.adapter';
import { ChatService } from './chat.service';
import { MessageController } from './message.controller';
import { MessageRepository } from './message-repository.interface';

/**
 * Messages: persistence, history, and from Phase 8 the socket.io gateway that
 * broadcasts them. `MessageRepository` is the one port; `ChatService` is what
 * both the REST routes here and that gateway will call.
 *
 * `AuthModule` is imported for `SessionAuthGuard`.
 *
 * `AdministrationModule` is imported for `RequireCapabilityGuard`'s sake, not
 * this module's own. `ChatService` needs neither channels nor memberships —
 * the guard has already settled access before it runs. But Nest instantiates
 * a `@UseGuards(Class)` enhancer in the *host* module's injector, so
 * `MessageController`'s guard resolves its `ChannelRepository`,
 * `MembershipRepository`, `ChannelMemberRepository` and
 * `ChannelOverrideRepository` here, from that module's exports.
 *
 * The guard is then listed below for the same reason `AdministrationModule`
 * lists it: so the wiring is a declaration rather than something that happens
 * to work.
 */
@Module({
  imports: [AuthModule, AdministrationModule],
  controllers: [MessageController],
  providers: [
    { provide: MessageRepository, useClass: PrismaMessageRepository },
    ChatService,
    RequireCapabilityGuard,
  ],
  exports: [MessageRepository, ChatService],
})
export class ChatModule {}
