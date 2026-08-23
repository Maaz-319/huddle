declare global {
  interface BigInt {
    toJSON(): string;
  }
}

/**
 * Makes every `bigint` serialize as a JSON string.
 *
 * `JSON.stringify` throws a `TypeError` on a raw `bigint`, so without this any
 * response carrying an ID is a 500. Patching the prototype globally is
 * preferred to a per-DTO interceptor because every `bigint` in this system is
 * a Snowflake ID — there is no case where one should serialize as anything
 * other than a string — and a per-DTO approach would mean remembering to
 * annotate every new DTO for the rest of the project.
 *
 * Call it before the Nest app is created.
 */
export function patchBigIntSerialization(): void {
  BigInt.prototype.toJSON = function (this: bigint): string {
    return this.toString();
  };
}
