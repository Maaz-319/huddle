import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommonModule } from './common/common.module';
import { validate } from './common/env.validation';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RateLimiterModule } from './rate-limiter/rate-limiter.module';
import { AdministrationModule } from './administration/administration.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    // The bus Administration emits access changes on and the gateway
    // listens to (#69). forRoot registers it global, so neither module
    // imports it themselves.
    EventEmitterModule.forRoot(),
    CommonModule,
    HealthModule,
    AuthModule,
    RateLimiterModule,
    AdministrationModule,
    ChatModule,
  ],
})
export class AppModule {}
