import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../common/prisma.service';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly database: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Reports the process, the database, and Redis.
   *
   * Both backing-store checks are real round trips -- a query and a PING -- so
   * a stopped Postgres or Redis turns this endpoint 503 rather than leaving it
   * cheerfully green.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.indicator.check('app').up(),
      () => this.database.pingCheck('database', this.prisma),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
