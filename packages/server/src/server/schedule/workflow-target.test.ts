import { describe, expect, test, vi } from "vitest";

import type { OrchestrationGraph } from "@otto-code/protocol/workflow";
import type { StoredSchedule } from "@otto-code/protocol/schedule/types";

import type { GraphStore } from "../workflow/graph-store.js";
import type { WorkflowStorageLocation } from "../workflow/workflow-store-registry.js";
import { ScheduleWorkflowTargetError } from "./service.js";
import { createWorkflowScheduleTargetRunner } from "./workflow-target.js";

const location: WorkflowStorageLocation = {
  storeKey: "workflows:host-a:project-a",
  projectRoot: "/projects/a",
  definitionsDirectory: "/projects/a/.otto/workflows/definitions",
  projectId: "project-a",
  projectKey: "project-a",
  location: "repository",
  hostId: "host-a",
};

function savedGraph(overrides: Partial<OrchestrationGraph> = {}): OrchestrationGraph {
  return {
    id: "graph-a",
    name: "Nightly checks",
    nodes: [],
    edges: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    workflowStorage: {
      schemaVersion: 1,
      storeKey: location.storeKey,
      projectRoot: location.projectRoot,
      projectId: location.projectId,
      projectKey: location.projectKey,
      location: location.location,
      hostId: location.hostId,
      source: "project-store",
    },
    ...overrides,
  };
}

function workflowSchedule(): StoredSchedule {
  return {
    id: "schedule-a",
    name: "Nightly Workflow",
    prompt: "legacy schedule metadata",
    cadence: { type: "every", everyMs: 60_000 },
    target: { type: "workflow", definitionId: "graph-a", projectRoot: "/projects/a" },
    status: "active",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    nextRunAt: "2026-08-29T00:01:00.000Z",
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [],
  };
}

function createRunner(input: {
  projectGraph: OrchestrationGraph | null;
  start?: ReturnType<typeof vi.fn>;
  resolve?: () => Promise<WorkflowStorageLocation>;
}) {
  const projectStore = { get: vi.fn(async () => input.projectGraph) } as unknown as GraphStore;
  const createGraphStore = vi.fn(() => projectStore);
  const start = input.start ?? vi.fn(async () => ({ runId: "workflow-run-a", agentId: "agent-a" }));
  return {
    start,
    createGraphStore,
    runner: createWorkflowScheduleTargetRunner({
      createGraphStore,
      workflowStoreRegistry: {
        resolveForCwd: input.resolve ?? (async () => location),
        provenanceFor: () => ({
          schemaVersion: 1,
          storeKey: location.storeKey,
          projectRoot: location.projectRoot,
          projectId: location.projectId,
          projectKey: location.projectKey,
          location: location.location,
          hostId: location.hostId,
          source: "project-store",
        }),
      } as never,
      orchestration: {} as never,
      start,
    }),
  };
}

describe("createWorkflowScheduleTargetRunner", () => {
  test("starts a project-store-only definition and retains schedule source and audit linkage", async () => {
    const { createGraphStore, runner, start } = createRunner({ projectGraph: savedGraph() });

    const result = await runner({ schedule: workflowSchedule(), runId: "schedule-run-a" });

    expect(createGraphStore).toHaveBeenCalledWith(location.definitionsDirectory);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ graphStore: expect.any(Object) }),
      expect.objectContaining({
        flavor: "graph",
        graphId: "graph-a",
        cwd: "/projects/a",
        scheduleSource: { scheduleId: "schedule-a", scheduleRunId: "schedule-run-a" },
      }),
    );
    expect(result).toMatchObject({
      agentId: "agent-a",
      workflow: {
        definitionId: "graph-a",
        projectRoot: "/projects/a",
        runId: "workflow-run-a",
      },
    });
    expect(result.workflow?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not let a same-id legacy global Graph satisfy a missing project target", async () => {
    // A matching Graph in the old daemon-wide library is deliberately absent
    // from the runner's dependencies. The target only reads its resolved
    // project's definitionsDirectory, so this schedule becomes repairable.
    const legacyGlobalGraph = savedGraph({ name: "Legacy copy" });
    expect(legacyGlobalGraph.id).toBe("graph-a");
    const { createGraphStore, runner, start } = createRunner({ projectGraph: null });

    await expect(runner({ schedule: workflowSchedule(), runId: "schedule-run-a" })).rejects.toThrow(
      ScheduleWorkflowTargetError,
    );
    expect(createGraphStore).toHaveBeenCalledWith(location.definitionsDirectory);
    expect(start).not.toHaveBeenCalled();
  });

  test.each([
    ["missing storage provenance", savedGraph({ workflowStorage: undefined })],
    [
      "host mismatch",
      savedGraph({ workflowStorage: { ...savedGraph().workflowStorage!, hostId: "host-b" } }),
    ],
    [
      "project identity mismatch",
      savedGraph({ workflowStorage: { ...savedGraph().workflowStorage!, projectId: "project-b" } }),
    ],
  ])("marks %s as a repairable target failure", async (_label, projectGraph) => {
    const { runner, start } = createRunner({ projectGraph });

    await expect(runner({ schedule: workflowSchedule(), runId: "schedule-run-a" })).rejects.toThrow(
      ScheduleWorkflowTargetError,
    );
    expect(start).not.toHaveBeenCalled();
  });

  test("marks unavailable project storage and failed startup as repairable", async () => {
    const unavailable = createRunner({
      projectGraph: null,
      resolve: async () => {
        throw new Error("host offline");
      },
    });
    await expect(
      unavailable.runner({ schedule: workflowSchedule(), runId: "schedule-run-a" }),
    ).rejects.toThrow(/Reconnect to its host/);

    const failedStart = createRunner({
      projectGraph: savedGraph(),
      start: vi.fn(async () => {
        throw new Error("capability unavailable");
      }),
    });
    await expect(
      failedStart.runner({ schedule: workflowSchedule(), runId: "schedule-run-a" }),
    ).rejects.toThrow(/failed to start/);
  });
});
