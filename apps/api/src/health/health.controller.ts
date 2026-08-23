import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../common/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly database: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reports the process and the database. Phase 2 adds a Redis indicator,
   * appending to this same array.
   *
   * The database check is a real query, so a stopped Postgres turns this
   * endpoint 503 rather than leaving it cheerfully green.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.indicator.check('app').up(),
      () => this.database.pingCheck('database', this.prisma),
    ]);
  }
}
