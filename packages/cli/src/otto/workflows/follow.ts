import {
  workflowRead,
  workflowWatch,
  WorkflowRef,
  unwrapWorkflowResult,
  normalizeWorkflowEntry,
  isTerminalRunStatus,
  type WorkflowEntry,
} from "@getpaseo/plugin/otto/workflows";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { workflowCliHostId, type WorkflowCliConnect } from "./connection.js";

export function workflowProgress(entry: WorkflowEntry) {
  if (entry.document.kind !== "run") throw new Error("Follow requires a Workflow run.");
  const run = entry.document.value;
  return {
    ref: entry.ref,
    revision: entry.revision,
    title: run.title,
    status: run.status,
    error: run.error ?? null,
    phases: run.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      agents: (phase.candidates ?? []).map((candidate) => candidate.agentId),
    })),
  };
}
/** One selected-daemon connection and demand-owned long poll. Ctrl+C closes observation, never cancels durable work. */
export async function followWorkflow(
  target: DaemonTarget,
  reference: (hostId: string) => WorkflowRef,
  emit: (entry: ReturnType<typeof workflowProgress>) => void,
  signal: AbortSignal,
  connect: WorkflowCliConnect = (selected) => connectToDaemon({ target: selected }),
) {
  signal.throwIfAborted();
  const client = await connect(target);
  let closing: Promise<void> | null = null;
  const close = () => (closing ??= client.close());
  const abort = () => {
    void close().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const ref = WorkflowRef.parse(reference(workflowCliHostId(client)));
    if (ref.kind !== "run") throw new Error("Follow requires --kind run.");
    let version = 0,
      revision: string | null = null;
    while (!signal.aborted) {
      const entry = normalizeWorkflowEntry(
        unwrapWorkflowResult(
          workflowRead.output.parse(
            await client.invokePluginRpc("otto-workflows", workflowRead.name, ref),
          ),
        ),
      );
      if (signal.aborted) return;
      const progress = workflowProgress(entry);
      if (entry.revision !== revision) {
        emit(progress);
        revision = entry.revision;
      }
      if (isTerminalRunStatus(progress.status)) return;
      const changed = unwrapWorkflowResult(
        workflowWatch.output.parse(
          await client.invokePluginRpc("otto-workflows", workflowWatch.name, {
            scope: ref.scope,
            version,
          }),
        ),
      );
      version = changed.version;
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    await close();
  }
}
