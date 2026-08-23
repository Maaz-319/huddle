import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  /**
   * Reports only that the process is up. Phase 1 adds a Postgres indicator and
   * Phase 2 a Redis one, each appending to this same array.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.indicator.check('app').up()]);
  }
}
