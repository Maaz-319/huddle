import { Injectable, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { EnvironmentVariables, NodeEnv } from './env.validation';

/**
 * Correlation ID keys for different transport layers.
 */
export const CORRELATION_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_KEY = 'requestId';

/**
 * A structured logger using pino under the hood, with automatic correlation
 * ID injection for both REST (request-scoped) and WebSocket (socket-scoped)
 * contexts.
 *
 * In REST, the correlation ID comes from the `x-request-id` header or is
 * generated per request. In WS, it's the socket ID from the handshake.
 *
 * All log lines are JSON with at minimum: `level`, `time`, `msg`, `context`,
 * and the correlation ID under `requestId` (REST) or `socketId` (WS).
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService {
  private logger: PinoLogger;
  private correlationId: string | undefined;
  private correlationType: 'requestId' | 'socketId' | undefined;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    const environment = config.get('NODE_ENV', { infer: true });
    const isTest = environment === NodeEnv.Test;

    const options: LoggerOptions = {
      level: isTest ? 'silent' : config.get('LOG_LEVEL', { infer: true }),
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        pid: process.pid,
      },
    };

    // Pretty print in development for readability
    if (!isTest && environment !== NodeEnv.Production) {
      this.logger = pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      });
    } else {
      this.logger = pino(options);
    }
  }

  /**
   * Set the correlation ID for the current context. Called once per request
   * (by the interceptor) or per socket connection (by the gateway).
   */
  setCorrelationId(
    id: string,
    type: 'requestId' | 'socketId' = 'requestId',
  ): void {
    this.correlationId = id;
    this.correlationType = type;
  }

  /**
   * Clear the correlation ID. Called at the end of a request or when a
   * socket disconnects.
   */
  clearCorrelationId(): void {
    this.correlationId = undefined;
    this.correlationType = undefined;
  }

  private baseObject(): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (this.correlationId && this.correlationType) {
      base[this.correlationType] = this.correlationId;
    }
    return base;
  }

  private write(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const base = this.baseObject();
    this.logger[level]({ ...base, context, ...meta }, message);
  }

  trace(
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    this.write('trace', context, message, meta);
  }

  debug(
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    this.write('debug', context, message, meta);
  }

  log(context: string, message: string, meta?: Record<string, unknown>): void {
    this.write('info', context, message, meta);
  }

  info(context: string, message: string, meta?: Record<string, unknown>): void {
    this.write('info', context, message, meta);
  }

  warn(context: string, message: string, meta?: Record<string, unknown>): void {
    this.write('warn', context, message, meta);
  }

  error(
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    this.write('error', context, message, meta);
  }

  fatal(
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    this.write('fatal', context, message, meta);
  }

  /**
   * Create a child logger with additional bound context. Useful for adding
   * persistent fields like `userId`, `serverId`, etc. that should appear on
   * every log line within a specific operation.
   */
  child(bindings: Record<string, unknown>): LoggerService {
    const child = new LoggerService(this.config);
    child.logger = this.logger.child(bindings);
    child.correlationId = this.correlationId;
    child.correlationType = this.correlationType;
    return child;
  }
}

/**
 * Generates a new correlation ID (UUID v4).
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extracts correlation ID from request headers, or generates a new one.
 */
export function getOrCreateCorrelationId(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const headerValue = request.headers[CORRELATION_ID_HEADER];
  if (headerValue) {
    return Array.isArray(headerValue) ? headerValue[0] : headerValue;
  }
  return generateCorrelationId();
}
