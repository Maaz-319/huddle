import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    CommonModule,
    HealthModule,
    AuthModule,
    RateLimiterModule,
    AdministrationModule,
    ChatModule,
  ],
})
export class AppModule {}
