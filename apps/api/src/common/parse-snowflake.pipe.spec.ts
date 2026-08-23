import { BadRequestException } from '@nestjs/common';
import { ParseSnowflakePipe } from './parse-snowflake.pipe';

describe('ParseSnowflakePipe', () => {
  const pipe = new ParseSnowflakePipe();

  it('parses an ID string into an equal bigint', () => {
    expect(pipe.transform('7311047234159968256')).toBe(7311047234159968256n);
  });

  it.each([
    ['letters', 'abc'],
    ['the empty string', ''],
    ['a negative number', '-1'],
    ['a decimal', '1.5'],
    ['hexadecimal', '0x1f'],
    ['a leading zero', '007'],
    ['zero', '0'],
    ['surrounding whitespace', ' 12 '],
    ['an ID past the signed 64-bit range', (2n ** 63n).toString()],
  ])('rejects %s with a 400', (_label, value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });
});
