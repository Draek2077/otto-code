import { createHash } from "node:crypto";

import type { OrchestrationGraph, WorkflowStorageProvenance } from "@otto-code/protocol/workflow";

// One definition of "the same Graph" for every Workflow surface. A share
// package's content hash, a schedule's fingerprint, and a start-confirmation
// review must all agree on what was reviewed, so they must all hash the same
// canonical form. Two copies of this code would drift apart silently.

/** Recursively sort object keys so hashing is independent of insertion order. */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

/** SHA-256 over the canonical JSON of a Graph document. */
export function graphHash(graph: OrchestrationGraph): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(graph)))
    .digest("hex");
}

/**
 * True when a persisted Graph's provenance says it belongs to exactly the
 * store a caller resolved. Used to refuse a Graph copied from another host or
 * project even when its file happens to be readable here.
 */
export function hasExpectedWorkflowStorage(
  actual: WorkflowStorageProvenance | undefined,
  expected: WorkflowStorageProvenance,
  compatibleStoreKeys: readonly string[] = [],
): boolean {
  if (!actual) return false;
  return (
    actual.schemaVersion === expected.schemaVersion &&
    actual.projectRoot === expected.projectRoot &&
    actual.projectId === expected.projectId &&
    actual.projectKey === expected.projectKey &&
    actual.location === expected.location &&
    (actual.storeKey === expected.storeKey || compatibleStoreKeys.includes(actual.storeKey)) &&
    actual.hostId === expected.hostId &&
    actual.hostName === expected.hostName &&
    actual.source === expected.source
  );
}
