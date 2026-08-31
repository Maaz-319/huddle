import { Prisma } from '../../generated/prisma/client';
import { generateInviteCode } from '../invite-code';

/** Prisma's code for "the record to update/delete was not found". */
export const RECORD_NOT_FOUND = 'P2025';

/** Prisma's code for "a unique constraint would be violated". */
export const UNIQUE_VIOLATION = 'P2002';

/**
 * Prisma's code for "a foreign key constraint would be violated".
 *
 * Reached when a write names a parent row that has since been deleted — a
 * message posted into a channel that was removed between the guard's read and
 * the insert. Unmapped it would surface as a 500; the honest answer is that
 * the parent is gone.
 */
export const FOREIGN_KEY_VIOLATION = 'P2003';

/** How many fresh codes a colliding write will try before giving up. */
const MAX_CODE_ATTEMPTS = 5;

/** Narrows a caught value to a Prisma error carrying a specific code. */
export function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/**
 * Runs `write` with a freshly minted invite code, retrying on a unique-code
 * collision with a new one.
 *
 * Bounded to five attempts rather than looping forever: at ~49 bits of entropy
 * a first collision is already improbable and a second means the generator is
 * broken, so an unbounded loop would spin silently instead of surfacing that.
 *
 * The retry has to wrap the *whole* write, including any surrounding
 * `$transaction`. A unique violation aborts the Postgres transaction it
 * happened in, so re-issuing the insert against the same `tx` fails with
 * `25P02` rather than succeeding with the new code.
 */
export async function withCodeRetry<T>(
  write: (code: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await write(generateInviteCode());
    } catch (error) {
      if (!hasPrismaCode(error, UNIQUE_VIOLATION)) throw error;

      lastError = error;
    }
  }

  throw lastError;
}
