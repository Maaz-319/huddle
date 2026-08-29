import 'express-session';
import { User as HuddleUser } from './user-repository.interface';

/**
 * The one field Huddle stores in the session payload: a stringified
 * Snowflake (session payloads are JSON, so `BigInt` cannot go in directly —
 * callers `BigInt(...)` it back out when reading).
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

/**
 * Passport assigns the value `validate()` returns to `req.user`, typed as the
 * (otherwise empty) `Express.User` interface. Merging our own `User` shape in
 * here means `req.user` is a real `User | undefined` everywhere, rather than
 * every reader casting it.
 */
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging into Express.User needs an interface, not a type alias
    interface User extends HuddleUser {}
  }
}
