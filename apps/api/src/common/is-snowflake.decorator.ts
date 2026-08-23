import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isSnowflakeString } from './snowflake.service';

/**
 * Converts a DTO field carrying a Snowflake ID string into a `bigint`.
 *
 * An invalid value is passed through untouched so that `@IsSnowflake()` is the
 * thing that reports the error, rather than a `SyntaxError` escaping the
 * transform as a 500.
 *
 * Use it alongside `@IsSnowflake()`, which runs after transformation:
 *
 *     @IsSnowflake()
 *     @TransformSnowflake()
 *     channelId!: bigint;
 */
export function TransformSnowflake(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && isSnowflakeString(value)
      ? BigInt(value)
      : value,
  );
}

/**
 * Validates that a DTO field holds a Snowflake ID — either the `bigint` left
 * by `@TransformSnowflake()`, or the raw string when transformation is off.
 *
 * A JSON number is rejected: IDs cross the wire as strings in both directions,
 * because a `number` cannot hold 64 bits without losing precision.
 */
export function IsSnowflake(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isSnowflake',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'bigint') {
            return isSnowflakeString(value.toString());
          }

          return typeof value === 'string' && isSnowflakeString(value);
        },
        defaultMessage(): string {
          return `${String(propertyName)} must be a Snowflake ID given as a string`;
        },
      },
    });
  };
}
