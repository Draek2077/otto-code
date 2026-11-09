import type { ViewReference } from "@getpaseo/plugin/otto/architectural-views";
import type { SourceDigest } from "./records.js";

export function viewSourceKey(reference: ViewReference): string {
  return `${reference.kind}:${reference.id}`;
}
/** Freshness is byte identity, not a claim that a person confirmed the source. */
export function viewSourceStatus(
  expected: SourceDigest[] | undefined,
  actual: SourceDigest[],
): "current" | "stale" | "unknown" {
  if (!expected?.length) return "unknown";
  const current = new Map(actual.map((row) => [viewSourceKey(row.reference), row.sha256]));
  let unknown = false;
  for (const row of expected) {
    const digest = current.get(viewSourceKey(row.reference));
    if (!row.sha256 || !digest) unknown = true;
    else if (digest !== row.sha256) return "stale";
  }
  return unknown ? "unknown" : "current";
}
