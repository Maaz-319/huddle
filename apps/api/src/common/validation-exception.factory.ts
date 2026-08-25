// class-validator exports its own `ValidationError`, which is a different
// thing entirely from ours: a per-property report, not a throwable.
import { ValidationError as ClassValidatorError } from 'class-validator';
import { ErrorDetails, ValidationError } from './errors';

/**
 * Turns `class-validator`'s report into our own `ValidationError`, so a DTO
 * rejection leaves the API in exactly the same envelope as a failure a service
 * raised by hand. Wire it into the global `ValidationPipe` as its
 * `exceptionFactory`; without it Nest emits its own
 * `{ statusCode, message: string[], error }` body instead.
 *
 * `details` maps each offending property to its messages, with nested DTOs
 * flattened to dotted paths:
 *
 *     { "limit": ["limit must not be greater than 100"],
 *       "author.name": ["author.name should not be empty"] }
 */
export function validationExceptionFactory(
  errors: ClassValidatorError[],
): ValidationError {
  return new ValidationError('Request validation failed', collect(errors));
}

function collect(errors: ClassValidatorError[], prefix = ''): ErrorDetails {
  const details: ErrorDetails = {};

  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      details[path] = Object.values(error.constraints);
    }

    if (error.children?.length) {
      Object.assign(details, collect(error.children, path));
    }
  }

  return details;
}
