import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PresenceStore } from './presence-store.interface';
import { RedisPresenceStore } from './adapters/redis-presence-store.adapter';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { AuthModule } from '../auth/auth.module';
import { AdministrationModule } from '../administration/administration.module';

/**
 * Presence module — live connection registry, heartbeat, online/offline state.
 *
 * Ports: `PresenceStore` (Redis, connection registry — intentionally ephemeral,
 * AGENTS.md section 8). `PresenceService` is what the gateway and other modules
 * call; it depends only on the port.
 *
 * `CommonModule` is imported for `RedisService` (which is `@Global()` but
 * explicit import keeps the dependency graph clear).
 */
@Module({
  imports: [CommonModule, AuthModule, AdministrationModule],
  controllers: [PresenceController],
  providers: [
    { provide: PresenceStore, useClass: RedisPresenceStore },
    PresenceService,
  ],
  exports: [PresenceStore, PresenceService],
})
export class PresenceModule {}
