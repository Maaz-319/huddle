import { randomBytes } from 'node:crypto';

/**
 * The alphabet an invite code is drawn from: uppercase letters and digits with
 * `0`, `O`, `1`, `I` and `L` removed, so a code can be read aloud or copied off
 * a screen without ambiguity. 31 characters.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code length. 31^10 is ~49 bits — plenty for a permanent, non-enumerable link. */
const CODE_LENGTH = 10;

/**
 * The largest byte value that keeps the draw uniform.
 *
 * 256 is not a multiple of 31, so `byte % 31` would land on the first
 * `256 % 31` characters of the alphabet more often than on the rest — a
 * measurable bias. Bytes at or above this ceiling are discarded instead
 * (rejection sampling), which costs a handful of extra draws and nothing else.
 */
const CEILING = 256 - (256 % ALPHABET.length);

/** A fresh invite code. Uniformly distributed over `ALPHABET`. */
export function generateInviteCode(): string {
  let code = '';

  while (code.length < CODE_LENGTH) {
    // Ask for the whole remainder at once: at this ceiling roughly 3% of bytes
    // are rejected, so one syscall almost always finishes the code.
    for (const byte of randomBytes(CODE_LENGTH - code.length)) {
      if (byte < CEILING) code += ALPHABET[byte % ALPHABET.length];
    }
  }

  return code;
}

/**
 * Whether `value` is shaped like an invite code.
 *
 * Lives beside the generator rather than in the controller that uses it, so
 * the two can never drift: a change to `ALPHABET` or `CODE_LENGTH` moves both
 * at once.
 */
export function isInviteCode(value: string): boolean {
  if (typeof value !== 'string' || value.length !== CODE_LENGTH) return false;

  return [...value].every((character) => ALPHABET.includes(character));
}
