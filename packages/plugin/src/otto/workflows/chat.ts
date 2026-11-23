import { WorkflowRef, type WorkflowRef as Ref } from "./runtime.js";
export const WORKFLOW_CHAT_ORIGIN_LABEL = "otto.workflow-origin";
export function workflowChatContext(
  labels: Readonly<Record<string, string>> | undefined,
  hostId: string,
): { ref: Ref; worker: boolean } | null {
  const id = labels?.["otto.workflow-worker-run-id"] ?? labels?.["otto.orchestration-run-id"],
    raw = labels?.[WORKFLOW_CHAT_ORIGIN_LABEL];
  if (!id || !raw || raw.length > 4000) return null;
  try {
    const ref = WorkflowRef.parse(JSON.parse(raw));
    if (ref.scope.hostId !== hostId || ref.kind !== "run" || ref.id !== id) return null;
    return { ref, worker: !!labels?.["otto.workflow-worker-run-id"] };
  } catch {
    return null;
  }
}
