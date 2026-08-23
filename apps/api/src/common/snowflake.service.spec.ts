import { Test, TestingModule } from '@nestjs/testing';
import { HUDDLE_EPOCH, SnowflakeService } from './snowflake.service';

describe('SnowflakeService', () => {
  let service: SnowflakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SnowflakeService],
    }).compile();

    service = module.get(SnowflakeService);
  });

  it('pins HUDDLE_EPOCH, which must never move once IDs exist', () => {
    expect(HUDDLE_EPOCH.toISOString()).toBe('2026-08-23T00:00:00.000Z');
  });

  it('mints strictly increasing, distinct IDs', () => {
    const first = service.generate();
    const second = service.generate();

    expect(second).toBeGreaterThan(first);
  });

  it('mints 10,000 unique IDs in a tight loop', () => {
    const ids = new Set<bigint>();

    for (let i = 0; i < 10_000; i++) {
      ids.add(service.generate());
    }

    expect(ids.size).toBe(10_000);
  });

  it('decodes the creation time of a fresh ID as roughly now', () => {
    const before = Date.now();

    const timestamp = service.timestampFrom(service.generate());

    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('decodes a timestamp relative to HUDDLE_EPOCH, not the Unix epoch', () => {
    jest.useFakeTimers().setSystemTime(HUDDLE_EPOCH.getTime() + 86_400_000);

    try {
      const timestamp = service.timestampFrom(service.generate());

      expect(timestamp.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });
});
