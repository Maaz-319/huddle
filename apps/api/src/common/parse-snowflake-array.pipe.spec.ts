import { BadRequestException } from '@nestjs/common';
import { ParseSnowflakeArrayPipe } from './parse-snowflake-array.pipe';

describe('ParseSnowflakeArrayPipe', () => {
  const pipe = new ParseSnowflakeArrayPipe();

  it('accepts at most 1,000 valid Snowflake IDs', () => {
    const values = Array.from({ length: 1_000 }, (_, index) =>
      String(index + 1),
    );

    expect(pipe.transform(values.join(','))).toHaveLength(1_000);
  });

  it('rejects a request containing more than 1,000 IDs', () => {
    const values = Array.from({ length: 1_001 }, (_, index) =>
      String(index + 1),
    );

    expect(() => pipe.transform(values.join(','))).toThrow(BadRequestException);
  });
});
