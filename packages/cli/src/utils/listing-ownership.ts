import type { CommandError } from "../output/index.js";

/** IDs are opaque daemon IDs, never names, prefixes, or directory paths to resolve. */
export function parseListingId(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const id = value.trim();
  if (!id) {
    throw { code: "INVALID_OPTIONS", message: `${flag} cannot be empty` } satisfies CommandError;
  }
  return id;
}
