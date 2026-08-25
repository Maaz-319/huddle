import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DomainError, ErrorResponseBody, RateLimitedError } from './errors';

/**
 * Codes for Nest's own `HttpException`s, which arrive here from the router
 * (an unmatched route) and from guards and interceptors that predate any
 * domain error. Keyed by status so a subclass we have not met still maps.
 */
const HTTP_STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/**
 * Renders every failure the API produces into the one documented shape, so a
 * client parses errors the same way whatever raised them:
 *
 *     { "error": { "code": "...", "message": "...", "details": { } } }
 *
 * Registered application-wide through `APP_FILTER` in `CommonModule` rather
 * than `app.useGlobalFilters()`, so it is active in tests that build the app
 * from `AppModule` and never run `main.ts`.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<unknown>();

    if (exception instanceof DomainError) {
      if (exception instanceof RateLimitedError) {
        httpAdapter.setHeader(
          response,
          'Retry-After',
          String(exception.retryAfter),
        );
      }

      httpAdapter.reply(
        response,
        body(exception.code, exception.message, exception.details),
        exception.status,
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      httpAdapter.reply(
        response,
        body(
          HTTP_STATUS_CODES[status] ?? 'HTTP_ERROR',
          messageOf(exception),
          undefined,
        ),
        status,
      );
      return;
    }

    // Nothing recognised it, so it is a bug rather than a handled failure.
    // The real error goes to the log; the client gets none of it, because an
    // unexpected error's message routinely carries a connection string, a
    // query, or a file path.
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    httpAdapter.reply(
      response,
      body('INTERNAL_ERROR', 'Internal server error', undefined),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

function body(
  code: string,
  message: string,
  details: Record<string, unknown> | undefined,
): ErrorResponseBody {
  return { error: details ? { code, message, details } : { code, message } };
}

/**
 * Nest's exception payload is either a string or an object whose `message` is
 * a string or an array of them, depending on which constructor was used.
 */
function messageOf(exception: HttpException): string {
  const payload: unknown = exception.getResponse();

  if (typeof payload === 'string') {
    return payload;
  }

  if (payload !== null && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload;

    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message)) {
      return message.map(String).join(', ');
    }
  }

  return exception.message;
}
