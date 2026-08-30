import type { OrchestrationGraph } from "@otto-code/protocol/workflow";
import type { ScheduleExecutionResult } from "@otto-code/protocol/schedule/types";

import type {
  UserOrchestrationDependencies,
  StartUserOrchestrationInput,
} from "../workflow/user-workflow.js";
import { startUserOrchestration } from "../workflow/user-workflow.js";
import { graphHash, hasExpectedWorkflowStorage } from "../workflow/graph-identity.js";
import type { GraphStore } from "../workflow/graph-store.js";
import type {
  WorkflowStorageProjectRecord,
  WorkflowStorageLocation,
  WorkflowStoreRegistry,
} from "../workflow/workflow-store-registry.js";
import { ScheduleWorkflowTargetError, type ScheduleWorkflowRunner } from "./service.js";

export interface WorkflowScheduleTargetRunnerDeps {
  /** The selected project's definition store. Never use the legacy global store. */
  createGraphStore: (directory: string) => GraphStore;
  workflowStoreRegistry: Pick<
    WorkflowStoreRegistry<WorkflowStorageProjectRecord>,
    "resolveForCwd" | "provenanceFor"
  >;
  orchestration: UserOrchestrationDependencies;
  start?: (
    deps: UserOrchestrationDependencies,
    input: StartUserOrchestrationInput,
  ) => ReturnType<typeof startUserOrchestration>;
}

/**
 * The narrow Schedule-to-Workflow boundary. A schedule may launch only the
 * exact saved Graph selected from its own project store. The ordinary Workflow
 * launcher retains all gate, access, tool-policy, and cap enforcement; this
 * adapter deliberately has no policy or autopilot knobs of its own.
 */
export function createWorkflowScheduleTargetRunner(
  deps: WorkflowScheduleTargetRunnerDeps,
): ScheduleWorkflowRunner {
  const start = deps.start ?? startUserOrchestration;
  return async ({ schedule, runId }): Promise<ScheduleExecutionResult> => {
    if (schedule.target.type !== "workflow") {
      throw new Error(`Schedule ${schedule.id} is not a Workflow target`);
    }

    let location: WorkflowStorageLocation;
    try {
      location = await deps.workflowStoreRegistry.resolveForCwd(schedule.target.projectRoot);
    } catch (error) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow storage is unavailable for ${schedule.target.projectRoot}. Reconnect to its host and resume this schedule. ${errorMessage(error)}`,
      );
    }
    const expected = deps.workflowStoreRegistry.provenanceFor(location);
    if (!expected) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow storage is unavailable for ${location.projectRoot}. Reconnect to its host and resume this schedule.`,
      );
    }
    let graphStore: GraphStore;
    let graph: OrchestrationGraph | null;
    try {
      graphStore = deps.createGraphStore(location.definitionsDirectory);
      graph = await graphStore.get(schedule.target.definitionId);
    } catch (error) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow storage could not be read for ${location.projectRoot}. Reconnect to its host and resume this schedule. ${errorMessage(error)}`,
      );
    }
    if (!graph) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow ${schedule.target.definitionId} is missing. Select a saved Workflow in ${location.projectRoot} and resume this schedule.`,
      );
    }
    if (graph.builtIn) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow ${graph.name} is a starter Graph. Save a project-scoped copy before scheduling it.`,
      );
    }
    if (!hasExpectedWorkflowStorage(graph.workflowStorage, expected, location.legacyStoreKeys)) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow ${graph.name} is unavailable on this host or does not belong to ${location.projectRoot}. Reconnect to its host or select a Workflow saved for this project.`,
      );
    }

    // The schedule prompt is intentionally not supplied to the Workflow
    // launcher. The saved Graph is the executable definition; using prompt text
    // here would turn a schedule into an undocumented definition editor.
    let started: Awaited<ReturnType<typeof startUserOrchestration>>;
    try {
      started = await start(
        { ...deps.orchestration, graphStore },
        {
          flavor: "graph",
          graphId: graph.id,
          cwd: location.projectRoot,
          title: graph.name,
          scheduleSource: { scheduleId: schedule.id, scheduleRunId: runId },
        },
      );
    } catch (error) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow ${graph.name} failed to start. Check host Workflow capability and retry after repair. ${errorMessage(error)}`,
      );
    }
    if (!started.runId) {
      throw new ScheduleWorkflowTargetError(
        `Saved Workflow ${graph.name} did not return a durable run. Retry after checking host Workflow capability.`,
      );
    }
    return {
      agentId: started.agentId ?? null,
      output: `Started saved Workflow ${graph.name}.`,
      workflow: {
        definitionId: graph.id,
        title: graph.name,
        kind: "graph",
        projectRoot: location.projectRoot,
        fingerprint: graphHash(graph),
        runId: started.runId,
      },
    };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
