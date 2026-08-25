import { Global, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { DomainExceptionFilter } from './domain-exception.filter';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SnowflakeService } from './snowflake.service';
import { validationExceptionFactory } from './validation-exception.factory';

/**
 * Shared primitives every other module may depend on. Global, so a feature
 * module gets these providers without importing this one explicitly.
 *
 * The pipe and the filter are registered here rather than in `main.ts` so that
 * they are equally active in tests that build the app from `AppModule`, which
 * never runs `main.ts`. Both tokens are application-scoped wherever they are
 * declared.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    RedisService,
    SnowflakeService,
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
  ],
  exports: [PrismaService, RedisService, SnowflakeService],
})
export class CommonModule {}
