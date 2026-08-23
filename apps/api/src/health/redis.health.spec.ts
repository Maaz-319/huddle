import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../common/redis.service';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  const ping = jest.fn();
  const up = jest.fn((details?: unknown) => ({
    redis: { status: 'up', ...(details ?? {}) },
  }));
  const down = jest.fn((details?: unknown) => ({
    redis: { status: 'down', ...(details ?? {}) },
  }));
  let indicator: RedisHealthIndicator;

  beforeEach(async () => {
    ping.mockReset();
    up.mockClear();
    down.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        {
          provide: HealthIndicatorService,
          useValue: { check: jest.fn().mockReturnValue({ up, down }) },
        },
        { provide: RedisService, useValue: { ping } },
      ],
    }).compile();

    indicator = module.get(RedisHealthIndicator);
  });

  it('reports up when Redis answers the ping', async () => {
    ping.mockResolvedValue('PONG');

    await expect(indicator.pingCheck('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('reports down, with the reason, when the connection is gone', async () => {
    ping.mockRejectedValue(new Error("Stream isn't writeable"));

    await expect(indicator.pingCheck('redis')).resolves.toEqual({
      redis: { status: 'down', message: "Stream isn't writeable" },
    });
  });
});
