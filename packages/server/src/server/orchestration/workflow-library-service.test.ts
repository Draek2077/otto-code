import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GraphStore } from "./graph-store.js";
import { PromptTemplateStore } from "./prompt-template-store.js";
import { WorkflowLibraryService } from "./workflow-library-service.js";
import type { WorkflowStorageLocation } from "./workflow-store-registry.js";

describe("WorkflowLibraryService", () => {
  let root: string;
  let repository: WorkflowStorageLocation;
  let host: WorkflowStorageLocation;
  let service: WorkflowLibraryService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-library-"));
    repository = location("repository", path.join(root, "project", ".otto", "workflows"));
    host = location("host", path.join(root, "host", "project-workflows", "project"));
    service = new WorkflowLibraryService(
      {
        resolveForCwd: async () => repository,
        discoverForProjectRoot: async () => ({ selected: repository, alternate: host }),
        provenanceFor: (resolved) => ({
          schemaVersion: 1,
          projectRoot: path.join(root, "project"),
          projectId: "project_1",
          projectKey: "project",
          location: resolved.location,
          storeKey: resolved.storeKey,
          source: "project-store",
        }),
      },
      {
        graphsDirectory: path.join(root, "legacy", "graphs"),
        templatesDirectory: path.join(root, "legacy", "templates"),
        runsDirectory: path.join(root, "legacy", "runs"),
      },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes graph and template definitions to the selected project store", async () => {
    const graph = await service.saveProjectGraph(root, graphRecord());
    const template = await service.saveProjectTemplate(root, templateRecord());

    await expect(
      new GraphStore(repository.definitionsDirectory).get(graph.id),
    ).resolves.toMatchObject({
      workflowStorage: { storeKey: repository.storeKey, source: "project-store" },
    });
    await expect(
      new PromptTemplateStore(repository.templatesDirectory).get(template.id),
    ).resolves.toMatchObject({ workflowStorage: { storeKey: repository.storeKey } });
  });

  it("copies legacy material only after a durable verified receipt, retaining the legacy source", async () => {
    await new GraphStore(path.join(root, "legacy", "graphs")).save(graphRecord());

    const receipt = await service.transfer({
      cwd: root,
      recordKind: "graph",
      recordId: "graph-1",
      source: "legacy-host-library",
      destination: "repository",
      mode: "copy",
    });

    expect(receipt).toMatchObject({
      status: "verified",
      source: { storeKey: "workflows:legacy-host-library" },
      destination: { storeKey: repository.storeKey },
    });
    await expect(
      new GraphStore(path.join(root, "legacy", "graphs")).get("graph-1"),
    ).resolves.toBeTruthy();
    await expect(
      new GraphStore(repository.definitionsDirectory).get("graph-1"),
    ).resolves.toMatchObject({
      workflowStorage: { storeKey: repository.storeKey },
    });
    await expect(service.listTransferReceipts(root)).resolves.toMatchObject([
      { status: "verified" },
    ]);
  });

  it("refuses destination collisions without changing either copy", async () => {
    await new GraphStore(path.join(root, "legacy", "graphs")).save(graphRecord());
    await service.saveProjectGraph(root, graphRecord());

    await expect(
      service.transfer({
        cwd: root,
        recordKind: "graph",
        recordId: "graph-1",
        source: "legacy-host-library",
        destination: "repository",
        mode: "move",
      }),
    ).rejects.toThrow("Destination already contains");
    await expect(
      new GraphStore(path.join(root, "legacy", "graphs")).get("graph-1"),
    ).resolves.toBeTruthy();
    await expect(
      new GraphStore(repository.definitionsDirectory).get("graph-1"),
    ).resolves.toBeTruthy();
  });

  it("records a failed transfer and retains its source when destination persistence interrupts", async () => {
    const legacyGraphs = path.join(root, "legacy", "graphs");
    await new GraphStore(legacyGraphs).save(graphRecord());
    const interrupted = new WorkflowLibraryService(
      {
        resolveForCwd: async () => repository,
        discoverForProjectRoot: async () => ({ selected: repository, alternate: host }),
        provenanceFor: (resolved) => ({
          schemaVersion: 1,
          projectRoot: path.join(root, "project"),
          location: resolved.location,
          storeKey: resolved.storeKey,
          source: "project-store",
        }),
      },
      {
        graphsDirectory: legacyGraphs,
        templatesDirectory: path.join(root, "legacy", "templates"),
        runsDirectory: path.join(root, "legacy", "runs"),
      },
      (directory) =>
        directory === repository.definitionsDirectory
          ? ({
              get: async () => null,
              save: async () => Promise.reject(new Error("disk interrupted")),
            } as GraphStore)
          : new GraphStore(directory),
    );

    await expect(
      interrupted.transfer({
        cwd: root,
        recordKind: "graph",
        recordId: "graph-1",
        source: "legacy-host-library",
        destination: "repository",
        mode: "move",
      }),
    ).rejects.toThrow("disk interrupted");
    await expect(new GraphStore(legacyGraphs).get("graph-1")).resolves.toBeTruthy();
    await expect(interrupted.listTransferReceipts(root)).resolves.toMatchObject([
      { status: "failed", recovery: expect.stringContaining("Source was retained") },
    ]);
  });

  it("surfaces a corrupt receipt without acting on any Workflow data", async () => {
    const receipts = path.join(repository.baseDirectory, "transfer-receipts");
    await mkdir(receipts, { recursive: true });
    await writeFile(path.join(receipts, "interrupted.json"), "not json", "utf-8");

    await expect(service.listTransferReceipts(root)).resolves.toMatchObject([
      { receiptId: "interrupted", status: "failed", recovery: expect.stringContaining("corrupt") },
    ]);
  });
});

function location(
  storeLocation: "repository" | "host",
  baseDirectory: string,
): WorkflowStorageLocation {
  return {
    category: "workflows",
    location: storeLocation,
    projectRoot: path.join(path.dirname(path.dirname(baseDirectory)), "project"),
    projectId: "project_1",
    projectKey: "project",
    hostId: null,
    hostName: null,
    baseDirectory,
    storeKey: `workflows:${storeLocation}:id:project_1`,
    legacyStoreKeys: [],
    definitionsDirectory: path.join(baseDirectory, "definitions"),
    templatesDirectory: path.join(baseDirectory, "templates"),
    runsDirectory: path.join(baseDirectory, "runs"),
  };
}

function graphRecord() {
  return {
    id: "graph-1",
    name: "Project graph",
    nodes: [{ id: "root", kind: "orchestrator", title: "Root" }],
  };
}

function templateRecord() {
  return {
    id: "template-1",
    name: "Project template",
    content: "hello",
  };
}
