import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsSnowflake, TransformSnowflake } from './is-snowflake.decorator';

class SendMessageDto {
  @IsSnowflake()
  @TransformSnowflake()
  channelId!: bigint;
}

const parse = (channelId: unknown) => {
  const dto = plainToInstance(SendMessageDto, { channelId });

  return { dto, errors: validateSync(dto) };
};

describe('@IsSnowflake() / @TransformSnowflake()', () => {
  it('turns a valid ID string into a bigint and accepts it', () => {
    const { dto, errors } = parse('7311047234159968256');

    expect(dto.channelId).toBe(7311047234159968256n);
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a non-numeric string', 'abc'],
    ['a JSON number, which cannot hold 64 bits', 7311047234159968256],
    ['null', null],
    ['an ID past the signed 64-bit range', (2n ** 63n).toString()],
  ])('rejects %s', (_label, channelId) => {
    const { errors } = parse(channelId);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('channelId');
    expect(errors[0].constraints).toHaveProperty('isSnowflake');
  });
});
