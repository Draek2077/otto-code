import type { ArtifactCaller, ArtifactWorkflowPort } from "../artifacts/sources.js";
import type { WorkflowHost } from "./host.js";
import type { WorkflowLibrary } from "./library.js";
/** Neither an editable chat label nor an Artifact's old run ID alone grants provenance. */
export function createWorkflowArtifactPort(
  host: () => WorkflowHost | null,
  library: () => WorkflowLibrary | null,
): ArtifactWorkflowPort {
  return {
    async caller(caller: ArtifactCaller) {
      if (!caller.agentId || !caller.workspaceId) return undefined;
      const binding = host()?.binding(caller.agentId);
      if (!binding || binding.request.workspace.workspaceId !== caller.workspaceId)
        return undefined;
      const entry = await library()?.read(binding.ref);
      if (entry?.document.kind !== "run") return undefined;
      const run = entry.document.value;
      let workflowId = run.graphId ?? run.id;
      if (run.launch?.kind === "ai") workflowId = run.launch.definition.id;
      return { kind: "workflow", workflowId, runId: run.id };
    },
    async read(scope, runId) {
      const owner = library();
      if (!owner) return null;
      const stores = await owner.ports.stores.locations(scope),
        legacy = owner.ports.stores.legacy(scope, stores[0].project, "run");
      if (legacy) stores.push(legacy);
      const found = [];
      for (const store of stores) {
        const entry = await owner.readAt(store, "run", runId);
        if (entry) found.push(entry.entry);
      }
      if (found.length !== 1) return null;
      const entry = found[0];
      if (entry.document.kind !== "run") return null;
      const run = entry.document.value;
      return {
        kind: "workflow",
        ref: entry.ref,
        title: run.title,
        status: run.status,
        workspaceId: run.workspaceId ?? null,
        conductorAgentId: run.conductorAgentId ?? null,
        summary: run.summary?.slice(0, 8000) ?? null,
        error: run.error?.slice(0, 2000) ?? null,
      };
    },
  };
}
