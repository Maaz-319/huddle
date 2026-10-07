import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { AuthModule } from '../auth/auth.module';
import { RequireCapabilityGuard } from '../auth/require-capability.guard';
import { RateLimiterModule } from '../rate-limiter/rate-limiter.module';
import { PrismaMessageRepository } from './adapters/prisma-message-repository.adapter';
import { RedisChatStateStore } from './adapters/redis-chat-state-store.adapter';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatStateStore } from './chat-state-store.interface';
import { MessageController } from './message.controller';
import { MessageRepository } from './message-repository.interface';

/**
 * Messages: persistence, history, the socket.io gateway that broadcasts
 * them, and from #65/#66 the three frames that mutate them — `message_send`,
 * `message_edit`, `message_delete`.
 *
 * Ports: `MessageRepository` (Postgres) and `ChatStateStore` (Redis,
 * idempotency — intentionally ephemeral, AGENTS.md section 8). `ChatService`
 * is what the REST routes and the gateway both call; the gateway additionally
 * owns the room set and the broadcast trio — the single emit site for
 * `message_create` / `message_update` / `message_delete`.
 *
 * `AuthModule` is imported for `SessionAuthGuard`.
 *
 * `AdministrationModule` is imported for `RequireCapabilityGuard`'s sake and
 * for `ChatService`'s authorization work. The guard needs the channel,
 * membership, channel-member and channel-override repositories to resolve the
 * caller's effective capability. `ChatService.requirePost` (the socket path,
 * which has no guard) and `ChatService.deleteMessage` re-resolve through the
 * same `resolveCapability` the guard uses, so they need the same four ports —
 * but for different moments: the guard settles access before the handler
 * runs; `requirePost` stands in for a guard that does not exist on a gateway
 * handler; the delete escalation only triggers when the caller is not the
 * author.
 *
 * `RateLimiterModule` is imported for the gateway's per-frame budget checks
 * — `message-send` on sends and `strict-mutation` on edits and deletes, the
 * same `RateLimiterService` the REST guards use, so both transports spend
 * from one bucket.
 *
 * The guard is then listed below for the same reason `AdministrationModule`
 * lists it: so the wiring is a declaration rather than something that happens
 * to work.
 */
@Module({
  imports: [AuthModule, AdministrationModule, RateLimiterModule],
  controllers: [MessageController],
  providers: [
    { provide: MessageRepository, useClass: PrismaMessageRepository },
    // Redis-backed idempotency for sends; the adapter is the only file here
    // that may touch `RedisService` (AGENTS.md section 2).
    { provide: ChatStateStore, useClass: RedisChatStateStore },
    ChatService,
    // The socket.io gateway, registered as a provider so Nest instantiates
    // it: `handleConnection` joins rooms on connect (#64), and the three
    // frame handlers (`message_send` #65, `message_edit`/`message_delete`
    // #66) ack the sender and broadcast. It injects
    // `AdministrationService`, `ChatService`, `ChatStateStore`,
    // `RateLimiterService` and `SnowflakeService`.
    ChatGateway,
    RequireCapabilityGuard,
  ],
  exports: [MessageRepository, ChatService],
})
export class ChatModule {}
