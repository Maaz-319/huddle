import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { EnvironmentVariables } from './env.validation';

/** Requires the configured browser origin for every state-changing REST call. */
@Injectable()
export class RequestOriginGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    const expected = this.config.get('WEB_ORIGIN', { infer: true });
    if (
      !isRequestOriginAllowed(request.method, request.headers.origin, expected)
    ) {
      throw new ForbiddenException('Request origin is not allowed');
    }

    return true;
  }
}

export function isRequestOriginAllowed(
  method: string,
  origin: string | undefined,
  expected: string,
): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return origin === expected;
}
