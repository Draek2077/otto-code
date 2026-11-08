import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { workflowHostFixture } from "../workflows/test-utils/host-fixture.js";
import { WorkflowScheduleAdapter } from "../workflows/schedule-adapter.js";
import { ArtifactDaemonService } from "../artifacts/service.js";
import { createScheduleComposition } from "./composition.js";
import { createScheduleTargetActions } from "./target-actions.js";
import type { ScheduleTargetCandidate } from "@getpaseo/plugin/otto/schedules";

const html =
  '<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1><script id="otto-artifact-data" type="application/json">{"value":1}</script></body></html>';
async function fixture() {
  const f = await workflowHostFixture();
  const generation = vi.fn(async () => {
    throw new Error("Review may not generate HTML");
  });
  const artifacts = new ArtifactDaemonService({
    home: f.home,
    hostId: f.scope.hostId,
    metadata: f.metadata,
    projects: async () => [{ projectId: f.scope.projectId, archivedAt: null }],
    workspaces: { get: async () => null },
    generation,
  });
  const composition = createScheduleComposition({
    home: f.home,
    hostId: f.scope.hostId,
    hostLabel: "Fixture",
    metadata: f.metadata,
    projects: async () => [{ projectId: f.scope.projectId }],
    workflows: new WorkflowScheduleAdapter(f.host),
    artifacts,
    generateData: async () => {
      throw new Error("Review may not start a model");
    },
  });
  const native = vi.fn(async () => "Native target");
  const selection = vi.fn(async () => {});
  const nativeCancel = vi.fn(async () => {});
  const extendedCancel = vi.fn(async () => {});
  let nativeRun = false;
  const actions = createScheduleTargetActions({
    ...composition,
    runtime: { cancel: extendedCancel },
    validateNative: native,
    validateSelection: selection,
    cancelNative: nativeCancel,
    isNativeRun: async () => nativeRun,
  });
  return {
    ...f,
    actions,
    composition,
    native,
    selection,
    nativeCancel,
    extendedCancel,
    generation,
    setNative: () => {
      nativeRun = true;
    },
    async graphTarget() {
      if (f.graph.kind !== "graph") throw new Error("Expected Graph");
      const saved = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
      const candidate: ScheduleTargetCandidate = {
        type: "workflow",
        source: { ...saved.ref, kind: "graph" },
        workspaceId: "workspace-1",
        seats: f.graph.seats,
        limits: f.graph.limits,
        inputs: {},
        approval: { allowTemplateCode: false, allowQueryEffects: false },
      };
      return { candidate, saved };
    },
    async artifactTarget() {
      const directory = path.join(f.repo, ".otto", "artifacts");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "report.html"), html);
      await writeFile(
        path.join(directory, "report.json"),
        JSON.stringify({
          id: "report",
          name: "Report",
          description: "Report",
          projectId: f.scope.projectId,
          status: "ready",
          starred: false,
          createdAt: "now",
          updatedAt: "now",
          generationProvider: null,
          generationModel: null,
          source: null,
          errorMessage: null,
        }),
      );
      const candidate: Extract<ScheduleTargetCandidate, { type: "artifact-update" }> = {
        type: "artifact-update",
        source: {
          scope: { hostId: f.scope.hostId, target: { kind: "project", id: f.scope.projectId } },
          location: "repository",
          id: "report",
        },
        update: { type: "data", json: '{"value":2}' },
      };
      return { candidate, directory };
    },
    async cleanup() {
      await composition.runtime.stop();
      await artifacts.close();
      await f.cleanup();
    },
  };
}
test("saved Graph review captures authority but neither review nor validation dispatches agents", async () => {
  const f = await fixture();
  try {
    const { candidate, saved } = await f.graphTarget();
    const reviewed = await f.actions.review({ scope: f.scope, target: candidate });
    expect(reviewed).toMatchObject({
      summary: "Graph",
      autopilot: null,
      target: { type: "workflow" },
    });
    await f.actions.validate({ scope: f.scope, target: reviewed.target });
    if (saved.document.kind !== "graph") throw new Error("Expected Graph");
    await f.library.write(
      f.scope,
      {
        kind: "graph",
        value: {
          ...saved.document.value,
          nodes: [
            ...saved.document.value.nodes,
            { id: "new-worker", kind: "agent", title: "New", prompt: "New" },
          ],
          edges: [...(saved.document.value.edges ?? []), { from: "root", to: "new-worker" }],
        },
      },
      saved.revision,
      saved.ref,
    );
    await expect(f.actions.validate({ scope: f.scope, target: reviewed.target })).rejects.toThrow(
      "authority changed",
    );
    expect(f.turns).toHaveLength(0);
    expect(f.agents.size).toBe(0);
    expect(f.host.status()).toMatchObject({ ready: true, active: [] });
  } finally {
    await f.cleanup();
  }
});
test("saved AI review reports its real autopilot setting and retains human approval intent", async () => {
  const f = await fixture();
  try {
    if (f.ai.kind !== "ai") throw new Error("Expected AI");
    const saved = await f.library.write(
      f.scope,
      { kind: "ai", value: { ...f.ai.definition, autopilot: false } },
      null,
    );
    const target: ScheduleTargetCandidate = {
      type: "workflow",
      source: { ...saved.ref, kind: "ai" },
      workspaceId: "workspace-1",
      seats: f.ai.definition.seats,
      limits: f.ai.definition.limits,
      inputs: {},
      approval: { allowTemplateCode: false, allowQueryEffects: false },
    };
    expect(await f.actions.review({ scope: f.scope, target })).toMatchObject({ autopilot: false });
    expect(f.agents.size).toBe(0);
    expect(f.turns).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
test("Artifact review captures design, validates JSON and rejects a changed design without publication", async () => {
  const f = await fixture();
  try {
    const { candidate, directory } = await f.artifactTarget();
    const reviewed = await f.actions.review({ scope: f.scope, target: candidate });
    expect(reviewed.summary).toBe("Report");
    await f.actions.validate({ scope: f.scope, target: reviewed.target });
    expect(await readFile(path.join(directory, "report.html"), "utf8")).toBe(html);
    await expect(
      f.actions.review({
        scope: f.scope,
        target: { ...candidate, update: { type: "data", json: "not JSON" } },
      }),
    ).rejects.toThrow();
    await writeFile(path.join(directory, "report.html"), html.replace("<h1>Report", "<h1>Changed"));
    await expect(f.actions.validate({ scope: f.scope, target: reviewed.target })).rejects.toThrow(
      "design changed",
    );
    expect(f.generation).not.toHaveBeenCalled();
    expect(f.selection).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("instruction selection and native targets are checked through owning policy ports", async () => {
  const f = await fixture();
  try {
    const { candidate } = await f.artifactTarget();
    const selected = { provider: "fixture", model: "fixture-model" };
    const reviewed = await f.actions.review({
      scope: f.scope,
      target: {
        ...candidate,
        update: { type: "instruction", instruction: "Update value", selection: selected },
      },
    });
    expect(f.selection).toHaveBeenLastCalledWith(selected, f.scope);
    await f.actions.validate({ scope: f.scope, target: reviewed.target });
    expect(f.selection).toHaveBeenCalledTimes(2);
    const target = { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000001" };
    expect(await f.actions.review({ scope: f.scope, target })).toEqual({
      target,
      summary: "Native target",
      autopilot: null,
    });
    expect(f.native).toHaveBeenCalledWith(target, f.scope);
  } finally {
    await f.cleanup();
  }
});
test("cancellation selects the exact run owner without substituting a current Schedule target", async () => {
  const f = await fixture();
  try {
    await f.actions.cancel("schedule", "extended-run");
    expect(f.extendedCancel).toHaveBeenCalledWith("schedule", "extended-run");
    expect(f.nativeCancel).not.toHaveBeenCalled();
    f.setNative();
    await f.actions.cancel("schedule", "native-run");
    expect(f.nativeCancel).toHaveBeenCalledWith("schedule", "native-run");
  } finally {
    await f.cleanup();
  }
});
