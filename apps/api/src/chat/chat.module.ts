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
 * `AdministrationModule` is imported for `RequireCapabilityGuard`'s sake and
 * for `ChatService`'s delete authorization. The guard needs the channel,
 * membership, channel-member and channel-override repositories to resolve the
 * caller's effective capability. `ChatService.deleteMessage` re-resolves
 * `delete_others` using the same `resolveCapability` path the guard uses, so
 * it needs the same four ports — but for a different message: the guard
 * settles access before the handler runs; the service escalates to
 * `delete_others` only when the caller is not the author.
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
