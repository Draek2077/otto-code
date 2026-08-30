import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestrationGraph } from "@otto-code/protocol/workflow";

import { GraphStore } from "./graph-store.js";
import { graphHash } from "./graph-identity.js";
import { GraphSharingService } from "./graph-sharing-service.js";
import type {
  WorkflowStorageProjectRecord,
  WorkflowStoreRegistry,
} from "./workflow-store-registry.js";

describe("GraphSharingService", () => {
  let root: string;
  let legacy: GraphStore;
  let destination: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "otto-graph-share-"));
    legacy = new GraphStore(path.join(root, "legacy"));
    destination = path.join(root, "project", ".otto", "workflows", "definitions");
    await legacy.save(graph());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("exports a compatible portable document and imports it only after confirmation", async () => {
    const service = new GraphSharingService(legacy, registry(destination));
    const exported = await service.exportGraph("g1");
    expect(exported.graph).toMatchObject({ format: "otto.workflow.graph", formatVersion: 1 });
    expect(exported.contentHash).toBe(graphHash(exported.graph));

    const review = await service.importGraph({ cwd: root, exported, confirmed: false });
    expect(review).toMatchObject({
      status: "review_required",
      source: exported.source,
      destination: { storeKey: "workflows:repository:project" },
    });
    expect(await new GraphStore(destination).get("g1")).toBeNull();

    const imported = await service.importGraph({ cwd: root, exported, confirmed: true });
    expect(imported).toMatchObject({ status: "imported", contentHash: exported.contentHash });
    expect(await new GraphStore(destination).get("g1")).toMatchObject({
      workflowStorage: { storeKey: "workflows:repository:project" },
      sharedFrom: { storeKey: "workflows:legacy-host-library", contentHash: exported.contentHash },
    });
  });

  it("lists only saved Graphs whose project storage provenance matches the selected store", async () => {
    const service = new GraphSharingService(legacy, registry(destination));
    const projectStore = new GraphStore(destination);
    await projectStore.save({
      ...graph(),
      id: "saved",
      name: "Saved Workflow",
      workflowStorage: registry(destination).provenanceFor(
        await registry(destination).resolveForCwd(root),
      ),
    });
    await projectStore.save({
      ...graph(),
      id: "stale",
      name: "Stale Workflow",
      workflowStorage: {
        ...registry(destination).provenanceFor(await registry(destination).resolveForCwd(root)),
        projectId: "other",
      },
    });

    await expect(service.listProjectGraphs(root)).resolves.toMatchObject([
      { id: "saved", name: "Saved Workflow" },
    ]);
  });

  it("rejects an unsupported document version with upgrade remediation", async () => {
    const service = new GraphSharingService(legacy, registry(destination));
    const exported = await service.exportGraph("g1");
    const newer = { ...exported, graph: { ...exported.graph, formatVersion: 2 } };
    const result = await service.importGraph({
      cwd: root,
      exported: { ...newer, contentHash: graphHash(newer.graph) },
      confirmed: true,
    });
    expect(result).toMatchObject({
      status: "failed",
      remediation: expect.stringContaining("Update Otto"),
    });
  });

  it("preserves the destination Graph on collision and names a recovery action", async () => {
    const store = new GraphStore(destination);
    await store.save({ ...graph(), name: "Destination Graph" });
    const service = new GraphSharingService(legacy, registry(destination));
    const result = await service.importGraph({
      cwd: root,
      exported: await service.exportGraph("g1"),
      confirmed: true,
    });
    expect(result).toMatchObject({
      status: "failed",
      remediation: expect.stringContaining("Rename"),
    });
    expect(await store.get("g1")).toMatchObject({ name: "Destination Graph" });
  });

  it("rejects corrupt input without creating a destination copy", async () => {
    const service = new GraphSharingService(legacy, registry(destination));
    const exported = await service.exportGraph("g1");
    const result = await service.importGraph({
      cwd: root,
      exported: { ...exported, contentHash: "0".repeat(64) },
      confirmed: true,
    });
    expect(result).toMatchObject({
      status: "failed",
      remediation: expect.stringContaining("hash"),
    });
    expect(await new GraphStore(destination).get("g1")).toBeNull();
  });

  it("leaves the source intact and reports retry after an interrupted destination copy", async () => {
    const service = new GraphSharingService(
      legacy,
      registry(destination),
      () =>
        ({
          get: async () => null,
          save: async () => {
            throw new Error("disk interrupted");
          },
        }) as unknown as GraphStore,
    );
    const result = await service.importGraph({
      cwd: root,
      exported: await service.exportGraph("g1"),
      confirmed: true,
    });
    expect(result).toMatchObject({
      status: "failed",
      remediation: expect.stringContaining("Retry"),
    });
    expect(await legacy.get("g1")).toMatchObject({ name: "Shareable Graph" });
  });
});

function graph(): OrchestrationGraph {
  return {
    id: "g1",
    name: "Shareable Graph",
    nodes: [{ id: "root", kind: "orchestrator", title: "Root" }],
  };
}

function registry(
  definitionsDirectory: string,
): WorkflowStoreRegistry<WorkflowStorageProjectRecord> {
  const location = {
    definitionsDirectory,
    storeKey: "workflows:repository:project",
    location: "repository",
    projectRoot: "project",
    projectId: "project_1",
    projectKey: "project",
    hostId: null,
    hostName: null,
    category: "workflows",
    baseDirectory: path.dirname(definitionsDirectory),
    templatesDirectory: "",
    runsDirectory: "",
  };
  return {
    resolveForCwd: async () => location,
    provenanceFor: () => ({
      schemaVersion: 1,
      projectRoot: "project",
      projectId: "project_1",
      projectKey: "project",
      location: "repository",
      storeKey: "workflows:repository:project",
      source: "project-store",
    }),
  } as unknown as WorkflowStoreRegistry<WorkflowStorageProjectRecord>;
}
