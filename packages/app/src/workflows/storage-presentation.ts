import type { WorkflowStorageProvenance } from "@otto-code/protocol/orchestration";

/** One feature decision for all Workflow storage UI, never a legacy fallback. */
export function supportsWorkflowStorage(input: {
  categoryStorageResolver?: { categories: readonly string[] };
}): boolean {
  return input.categoryStorageResolver?.categories.includes("workflows") === true;
}

/** Source text intentionally distinguishes old global material from project stores. */
export function describeWorkflowStorageSource(
  provenance: WorkflowStorageProvenance | undefined,
): string {
  if (!provenance || provenance.source === "legacy-host-library") return "Legacy host library";
  if (provenance.location === "repository") return "Repository";
  return `Host-local · ${provenance.hostName ?? "this host"}`;
}

/** Never claim remote host-local material is available through a different host. */
export function describeWorkflowStorageRemediation(input: {
  provenance: WorkflowStorageProvenance | undefined;
  connectedHostId: string | null;
}): string | null {
  const provenance = input.provenance;
  if (
    provenance?.source === "project-store" &&
    provenance.location === "host" &&
    provenance.hostId &&
    provenance.hostId !== input.connectedHostId
  ) {
    return `Reconnect ${provenance.hostName ?? "the originating host"} or use an explicit verified transfer.`;
  }
  return null;
}
