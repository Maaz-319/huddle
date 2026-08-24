import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from '../common/redis.service';

/**
 * The Redis half of GET /health. Terminus ships no Redis indicator that does
 * not drag in @nestjs/microservices, so this is a small one built on the same
 * HealthIndicatorService the controller already uses for the process check.
 *
 * The probe is a real PING. With the client's offline queue disabled it fails
 * fast rather than blocking the endpoint while a dead connection is retried.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);

    try {
      await this.redis.ping();

      return check.up();
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
