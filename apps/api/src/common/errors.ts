/**
 * The domain error types every service raises, and the single response shape
 * they are rendered into.
 *
 * These are deliberately plain classes, not Nest `HttpException`s. A
 * `*.service.ts` holds business logic and must stay free of the framework
 * boundary — the same failure has to surface as an HTTP status from a
 * controller and as a WS error frame from a gateway later on, so the error
 * carries its `code` and `status` as data and lets each transport read them.
 * Mapping to HTTP is `DomainExceptionFilter`'s job.
 *
 * Every non-2xx response the API emits, without exception, has this shape:
 *
 *     { "error": { "code": "NOT_FOUND",
 *                  "message": "Channel not found",
 *                  "details": { "channelId": "123" } } }
 *
 * `details` is omitted entirely when there is nothing to put in it, rather
 * than serialised as an empty object.
 */

/** Structured, client-safe context attached to a failure. Never internals. */
export type ErrorDetails = Record<string, unknown>;

/** The rendered body of a failure response. */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
  };
}

export abstract class DomainError extends Error {
  /** The machine-readable code clients switch on. Explicit, never derived. */
  abstract readonly code: string;

  /** The HTTP status the filter renders this as. */
  abstract readonly status: number;

  readonly details?: ErrorDetails;

  constructor(message: string, details?: ErrorDetails) {
    super(message);

    // Extending a built-in resets the prototype to Error's under this TS
    // target, which would make every `instanceof DomainError` in the filter
    // false and route real domain errors into the generic 500 branch.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = new.target.name;
    this.details = details;
  }
}

/** The request was understood but its contents are not acceptable. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
}

/** The caller is not known — no session, or the session names nobody real. */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
  readonly status = 401;
}

/** The caller is known but is not allowed to do this. */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
}

/** The addressed resource does not exist, or is not visible to the caller. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
}

/** The request collides with existing state — a duplicate, a second owner. */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly status = 409;
}

/**
 * The caller is over budget.
 *
 * `retryAfter` is in whole seconds and becomes the `Retry-After` header on the
 * REST rejection, which docs/architecture/rate-limiter.md section 6 requires.
 */
export class RateLimitedError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number, details?: ErrorDetails) {
    super(message, details);
    this.retryAfter = retryAfter;
  }
}
