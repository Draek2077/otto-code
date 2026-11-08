import { preserveUnknownFields } from "../store-continuity.js";
import type { StoredSchedule } from "./types.js";
/** Reuse the existing continuity merge under the registry's byte-CAS publisher. A deliberate
 * target-kind replacement removes that old target, rather than grafting its private fields
 * into a different executor. Same-kind edits retain fields whose owners have not returned. */
export function preserveScheduleDiskRecord(
  original: unknown,
  current: StoredSchedule,
  next: StoredSchedule,
): unknown {
  let parsed: unknown = current;
  if (
    current.target.type !== next.target.type &&
    original &&
    typeof original === "object" &&
    "target" in original
  )
    parsed = { ...current, target: original.target };
  return preserveUnknownFields(original, parsed, next);
}
