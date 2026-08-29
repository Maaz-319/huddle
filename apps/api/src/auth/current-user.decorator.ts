import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { User } from './user-repository.interface';

/**
 * Reads the `User` `SessionAuthGuard` already resolved and attached to
 * `req.user`. Only meaningful behind that guard — a route using this without
 * `@UseGuards(SessionAuthGuard)` gets `undefined` at runtime despite the
 * `User` return type, the same trust the guard's own ordering guarantee
 * relies on elsewhere in Nest (guards always run before parameter
 * decorators).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.user as User;
  },
);
