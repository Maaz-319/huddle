import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Shared primitives every other module may depend on. Global, so a feature
 * module gets these providers without importing this one explicitly.
 */
@Global()
@Module({
  providers: [PrismaService, RedisService, SnowflakeService],
  exports: [PrismaService, RedisService, SnowflakeService],
})
export class CommonModule {}
