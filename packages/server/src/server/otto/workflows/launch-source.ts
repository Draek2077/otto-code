import type { WorkflowLaunch, WorkflowScope } from "@getpaseo/plugin/otto/workflows";
import type { WorkflowLibrary } from "./library.js";
import { canonicalJson } from "./graph-identity.js";
import { WorkflowError, workflowDigest } from "./files.js";
/** A saved definition edited after review cannot redeem its old start token. Draft launches bind their complete captured payload instead. */
export async function assertWorkflowLaunchSource(
  library: WorkflowLibrary,
  scope: WorkflowScope,
  launch: WorkflowLaunch,
): Promise<void> {
  const source = launch.source;
  if (!source) return;
  if (
    source.ref.scope.hostId !== scope.hostId ||
    source.ref.scope.projectId !== scope.projectId ||
    source.ref.kind !== launch.kind
  )
    throw new WorkflowError("invalid", "Workflow launch source belongs to another project/kind.");
  const entry = await library.read(source.ref);
  const value = launch.kind === "ai" ? launch.definition : launch.graph;
  if (
    entry.revision !== source.revision ||
    workflowDigest(JSON.stringify(canonicalJson(entry.document.value))) !==
      workflowDigest(JSON.stringify(canonicalJson(value)))
  )
    throw new WorkflowError(
      "conflict",
      "Saved Workflow changed since review. Refresh the definition and review this launch again.",
    );
}
