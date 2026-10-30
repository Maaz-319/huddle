import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUrl,
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
 * Every declared property is required and validated at startup.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  WEB_ORIGIN!: string;

  /**
   * How many reverse-proxy hops sit in front of the app, for Express's
   * `trust proxy`. Zero locally, where nothing is in front; in production it is
   * the number of proxies Render actually terminates through.
   *
   * A count, never `true`. Trusting every hop lets any client forge
   * `X-Forwarded-For` and mint itself an endless supply of fresh rate-limit
   * buckets, which defeats the per-IP dimension entirely
   * (docs/architecture/rate-limiter.md section 3).
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUSTED_PROXY_HOPS!: number;

  @IsIn(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  LOG_LEVEL!: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

  /** GitHub OAuth App client id (docs/architecture/auth-service.md section 2). */
  @IsString()
  @IsNotEmpty()
  GITHUB_CLIENT_ID!: string;

  /** GitHub OAuth App client secret. Never logged, never persisted. */
  @IsString()
  @IsNotEmpty()
  GITHUB_CLIENT_SECRET!: string;

  /**
   * Must exactly match the callback URL registered on the GitHub OAuth App,
   * or GitHub rejects the redirect outright.
   */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  GITHUB_CALLBACK_URL!: string;

  /**
   * Signs the session cookie. `express-session` throws at first use without
   * one, so this is required rather than defaulted.
   */
  @IsString()
  @IsNotEmpty()
  SESSION_SECRET!: string;
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
