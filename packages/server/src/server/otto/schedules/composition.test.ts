import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { workflowHostFixture } from "../workflows/test-utils/host-fixture.js";
import { WorkflowScheduleAdapter } from "../workflows/schedule-adapter.js";
import { ArtifactDaemonService } from "../artifacts/service.js";
import { replaceArtifactData } from "../artifacts/content.js";
import { createScheduleComposition } from "./composition.js";
import { artifactDesignFingerprint } from "./artifact-adapter.js";
import type { ScheduleAudit, ScheduleTarget, StoredSchedule } from "./types.js";

const html =
  '<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1><script id="otto-artifact-data" type="application/json">{"value":1}</script></body></html>';
async function fixture() {
  const f = await workflowHostFixture();
  const generation = vi.fn(async () => {
    throw new Error("Schedule must not regenerate HTML");
  });
  const artifacts = new ArtifactDaemonService({
    home: f.home,
    hostId: f.scope.hostId,
    metadata: f.metadata,
    workspaces: { get: async () => null },
    projects: async () => [{ projectId: f.scope.projectId, archivedAt: null }],
    generation,
  });
  const generateData = vi.fn(async () => {
    throw new Error("Literal data must not admit a provider");
  });
  const projects = vi.fn(async () => [...f.records.keys()].map((projectId) => ({ projectId })));
  const metadataRead = vi.spyOn(f.metadata, "read");
  const composition = createScheduleComposition({
    home: f.home,
    hostId: f.scope.hostId,
    hostLabel: "Fixture",
    metadata: f.metadata,
    projects,
    workflows: new WorkflowScheduleAdapter(f.host),
    artifacts,
    generateData,
  });
  const create = async (target: ScheduleTarget) => {
    const origin = await composition.stores.selected(f.scope);
    const schedule: Omit<StoredSchedule, "id"> = {
      name: "Scheduled work",
      prompt: "Run the saved target",
      target,
      cadence: { type: "every", everyMs: 60000 },
      status: "active",
      createdAt: "2026-11-08T00:00:00Z",
      updatedAt: "2026-11-08T00:00:00Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      maxRuns: null,
      expiresAt: null,
      runs: [],
      otto: {
        version: 1,
        scope: origin.scope,
        location: origin.location,
        storeKey: origin.storeKey,
      },
    };
    return composition.registry.create(schedule);
  };
  const execute = (schedule: StoredSchedule) =>
    composition.runtime.execute({
      schedule,
      runId: "composition-fire",
      stamp: async (_audit: Partial<ScheduleAudit>) => {},
      legacy: async () => {
        throw new Error("Extended targets must not enter the native runner");
      },
    });
  return {
    ...f,
    composition,
    artifacts,
    projects,
    metadataRead,
    generation,
    generateData,
    create,
    execute,
    async cleanup() {
      await composition.runtime.stop();
      await artifacts.close();
      await f.cleanup();
    },
  };
}

test("composition starts no scans, providers, models or extra clocks", async () => {
  const f = await fixture();
  try {
    expect(f.projects).not.toHaveBeenCalled();
    expect(f.metadataRead).not.toHaveBeenCalled();
    expect(f.generation).not.toHaveBeenCalled();
    expect(f.generateData).not.toHaveBeenCalled();
    expect(f.agents.size).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("project registry records dispatch saved Graph work through the existing Workflow owner", async () => {
  const f = await fixture();
  try {
    if (f.graph.kind !== "graph") throw new Error("Expected Graph");
    const source = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    const target = await f.composition.workflows.review(
      {
        type: "workflow",
        source: { ...source.ref, kind: "graph" },
        workspaceId: "workspace-1",
        seats: f.graph.seats,
        limits: f.graph.limits,
        inputs: {},
        approval: {
          policyFingerprint: "a".repeat(64),
          allowTemplateCode: false,
          allowQueryEffects: false,
        },
      },
      f.scope,
    );
    const schedule = await f.create(target);
    expect((await f.composition.registry.entry(schedule.id))?.ref.scope).toEqual(f.scope);
    const result = await f.execute(schedule);
    expect(result.audit?.result).toMatchObject({
      kind: "workflow",
      ref: { kind: "run", scope: f.scope },
    });
    expect(result.audit?.disposition).toBe("succeeded");
    expect(f.turns.length).toBeGreaterThan(0);
    expect(f.generateData).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test("project Artifact data work uses the shared owner and cannot regenerate its design", async () => {
  const f = await fixture();
  try {
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
    const source = {
      scope: {
        hostId: f.scope.hostId,
        target: { kind: "project" as const, id: f.scope.projectId },
      },
      id: "report",
      location: "repository" as const,
    };
    const schedule = await f.create({
      type: "artifact-update",
      source,
      designFingerprint: artifactDesignFingerprint(html),
      update: { type: "data", json: '{"value":2}' },
    });
    const result = await f.execute(schedule);
    expect(result.audit?.result).toMatchObject({ kind: "artifact", ref: source });
    expect(await readFile(path.join(directory, "report.html"), "utf8")).toBe(
      replaceArtifactData(html, '{"value":2}'),
    );
    expect((await f.artifacts.read(source)).artifact.source).toEqual({
      kind: "schedule",
      scheduleId: schedule.id,
      runId: "composition-fire",
    });
    expect(f.generation).not.toHaveBeenCalled();
    expect(f.generateData).not.toHaveBeenCalled();
    expect(f.agents.size).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("an archived owning project blocks target admission and retains the Schedule", async () => {
  const f = await fixture();
  try {
    const schedule = await f.create({
      type: "artifact-update",
      source: {
        scope: { hostId: f.scope.hostId, target: { kind: "project", id: f.scope.projectId } },
        id: "report",
        location: "repository",
      },
      designFingerprint: "a".repeat(64),
      update: { type: "data", json: "{}" },
    });
    const project = await f.metadata.read(f.scope.projectId);
    f.put(f.scope.projectId, f.repo, { ...project.record, archivedAt: "2026-11-08T01:00:00Z" });
    await expect(f.execute(schedule)).rejects.toMatchObject({ disposition: "repair_required" });
    expect((await f.composition.registry.entry(schedule.id))?.schedule.target).toEqual(
      schedule.target,
    );
    expect(f.generation).not.toHaveBeenCalled();
    expect(f.generateData).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
