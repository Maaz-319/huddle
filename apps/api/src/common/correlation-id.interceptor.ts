import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import {
  LoggerService,
  getOrCreateCorrelationId,
  CORRELATION_ID_HEADER,
} from './logger.service';

/**
 * Interceptor that binds a correlation ID to the request-scoped LoggerService
 * for the duration of the request, and echoes it back in the response header
 * so clients can correlate their logs with server logs.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(
    @Inject(LoggerService)
    private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const correlationId = getOrCreateCorrelationId(request);
    this.logger.setCorrelationId(correlationId, 'requestId');

    // Echo back so clients can correlate
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            context.getClass().name,
            `${request.method} ${request.url} ${response.statusCode}`,
            { duration, statusCode: response.statusCode },
          );
        },
        error: (error: unknown) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            context.getClass().name,
            `${request.method} ${request.url} failed`,
            {
              duration,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        },
        complete: () => {
          this.logger.clearCorrelationId();
        },
      }),
    );
  }
}
