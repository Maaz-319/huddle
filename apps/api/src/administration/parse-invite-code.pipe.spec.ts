import { BadRequestException } from '@nestjs/common';
import { generateInviteCode } from './invite-code';
import { ParseInviteCodePipe } from './parse-invite-code.pipe';

describe('ParseInviteCodePipe', () => {
  const pipe = new ParseInviteCodePipe();

  it('passes a real generated code straight through', () => {
    const code = generateInviteCode();

    expect(pipe.transform(code)).toBe(code);
  });

  it.each([
    ['too short', 'ABCDEFGHJ'],
    ['too long', 'ABCDEFGHJK2'],
    ['empty', ''],
    ['an excluded character', 'ABCDEFGHJ0'],
    ['lowercase', 'abcdefghjk'],
    ['a Snowflake, which this is not', '999000000000000001'],
  ])('rejects %s with a 400', (_label, value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });
});
