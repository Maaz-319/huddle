import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * The environment contract. Every variable the API reads is declared here and
 * in .env.example; the two are kept in step in the same commit.
 *
 * Properties with an initializer are optional in the environment and fall back
 * to that value. Properties without one are required.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsNotEmpty()
  WEB_ORIGIN: string = 'http://localhost:5173';
}

/**
 * Passed to ConfigModule.forRoot. Throws on any problem, so a misconfigured
 * deployment dies at startup rather than at the first request that needs the
 * value. The returned instance is what ConfigService then serves, which is how
 * PORT reaches callers as a number rather than a string.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = Object.values(error.constraints ?? {}).join('; ');
        return `  ${error.property}: ${constraints || 'is invalid'}`;
      })
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
