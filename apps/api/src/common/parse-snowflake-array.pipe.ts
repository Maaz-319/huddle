import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isSnowflakeString } from './snowflake.service';

/**
 * Parses a comma-separated list of Snowflake ID strings into `bigint[]`.
 *
 * Used for query parameters like `?userIds=123,456,789`.
 * Rejects empty strings, non-string values, and any ID that is not a
 * plausible Snowflake with a 400.
 */
@Injectable()
export class ParseSnowflakeArrayPipe implements PipeTransform<
  string,
  bigint[]
> {
  transform(value: string): bigint[] {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(
        'Expected a comma-separated list of Snowflake IDs',
      );
    }

    const parts = value.split(',').map((part) => part.trim());

    if (parts.some((part) => part === '')) {
      throw new BadRequestException('Empty ID in comma-separated list');
    }

    for (const part of parts) {
      if (!isSnowflakeString(part)) {
        throw new BadRequestException(`Invalid Snowflake ID: ${part}`);
      }
    }

    return parts.map((part) => BigInt(part));
  }
}
