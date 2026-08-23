import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isSnowflakeString } from './snowflake.service';

/**
 * Parses a Snowflake route parameter — `:serverId`, `:channelId`,
 * `:messageId` — into a `bigint`, rejecting anything that is not a plausible
 * ID with a 400.
 *
 * A JS `number` cannot hold a Snowflake, so `ParseIntPipe` is not an option:
 * it would silently lose precision rather than throw.
 */
@Injectable()
export class ParseSnowflakePipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    if (typeof value !== 'string' || !isSnowflakeString(value)) {
      throw new BadRequestException('Expected a Snowflake ID');
    }

    return BigInt(value);
  }
}
