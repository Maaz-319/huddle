import { Global, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { DomainExceptionFilter } from './domain-exception.filter';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SnowflakeService } from './snowflake.service';
import { validationExceptionFactory } from './validation-exception.factory';
import { LoggerService } from './logger.service';
import { CorrelationIdInterceptor } from './correlation-id.interceptor';
import { RequestOriginGuard } from './request-origin.guard';

/**
 * Shared primitives every other module may depend on. Global, so a feature
 * module gets these providers without importing this one explicitly.
 *
 * The pipe, filter, and interceptor are registered here rather than in
 * `main.ts` so that they are equally active in tests that build the app from
 * `AppModule`, which never runs `main.ts`. All tokens are application-scoped
 * wherever they are declared.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    RedisService,
    SnowflakeService,
    LoggerService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_GUARD, useClass: RequestOriginGuard },
  ],
  exports: [PrismaService, RedisService, SnowflakeService, LoggerService],
})
export class CommonModule {}
