import { Injectable } from '@nestjs/common';
import { Snowflake } from '@sapphire/snowflake';

/**
 * The point in time every Huddle ID's timestamp is measured from.
 *
 * It must NEVER change once IDs exist in any database. Every ID encodes the
 * milliseconds elapsed since this instant, and `User` and `Message` have no
 * `createdAt` column precisely because it is decoded from the ID
 * (docs/architecture/data-model.md section 3). Moving the epoch silently
 * reinterprets the creation time of every row already written.
 */
export const HUDDLE_EPOCH = new Date('2026-08-23T00:00:00.000Z');

/** The largest value Postgres `BigInt` (a signed 64-bit integer) can hold. */
const MAX_SNOWFLAKE = 2n ** 63n - 1n;

/**
 * Whether a string is a plausible Snowflake: digits only, no sign, no leading
 * zeros, non-zero, and within signed 64-bit range.
 *
 * The check is deliberately shape-only — it does not decode the timestamp and
 * compare it to the clock, which would make validation fail on clock skew.
 *
 * Shared by `ParseSnowflakePipe` and `@IsSnowflake()` so the rule for what an
 * ID looks like on the wire lives in exactly one place.
 */
export function isSnowflakeString(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) {
    return false;
  }

  return BigInt(value) <= MAX_SNOWFLAKE;
}

/**
 * Mints the 64-bit Snowflake IDs used as the primary key of every independent
 * entity (docs/architecture/data-model.md section 2).
 */
@Injectable()
export class SnowflakeService {
  private readonly snowflake = new Snowflake(HUDDLE_EPOCH);

  /** A new ID, strictly greater than every ID this process has minted. */
  generate(): bigint {
    return this.snowflake.generate();
  }

  /** The moment an ID was minted, decoded from the ID itself. */
  timestampFrom(id: bigint): Date {
    return new Date(this.snowflake.timestampFrom(id));
  }
}
