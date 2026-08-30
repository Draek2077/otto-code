import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "@otto-code/protocol/workflow";

import { RunStore } from "./workflow-run-file-store.js";
import { WorkflowRunStore } from "./workflow-run-store.js";

describe("WorkflowRunStore", () => {
  let root: string;
  let legacyDirectory: string;
  let repositoryRunsDirectory: string;
  let hostRunsDirectory: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-run-store-"));
    legacyDirectory = path.join(root, "legacy", "runs");
    repositoryRunsDirectory = path.join(root, "project", ".otto", "workflows", "runs");
    hostRunsDirectory = path.join(root, "host", "project-workflows", "project", "runs");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function store() {
    return new WorkflowRunStore(
      {
        discoverAllProjectStores: async () => [
          { runsDirectory: repositoryRunsDirectory },
          { runsDirectory: hostRunsDirectory },
        ],
        resolveRecordedStore: async ({ storeKey }) => {
          if (storeKey === "workflows:repository:project_1") {
            return { runsDirectory: repositoryRunsDirectory };
          }
          if (storeKey === "workflows:host:project_1") return { runsDirectory: hostRunsDirectory };
          throw new Error("Recorded store is unavailable");
        },
      },
      legacyDirectory,
    );
  }

  function run(id: string, storeKey?: string): Run {
    return {
      id,
      title: id,
      status: "done",
      kind: "ai",
      phases: [],
      cwd: path.join(root, "project"),
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      ...(storeKey
        ? {
            workflowStorage: {
              schemaVersion: 1,
              projectRoot: path.join(root, "project"),
              projectId: "project_1",
              location: storeKey.includes(":host:") ? "host" : "repository",
              storeKey,
              source: "project-store" as const,
            },
          }
        : {}),
    };
  }

  it("writes a new Workflow to its recorded project store and retains legacy records", async () => {
    const runs = store();
    await runs.save(run("project-run", "workflows:repository:project_1"));
    await new RunStore(legacyDirectory).save(run("legacy-run"));

    await expect(new RunStore(repositoryRunsDirectory).get("project-run")).resolves.toMatchObject({
      id: "project-run",
    });
    await expect(new RunStore(legacyDirectory).get("project-run")).resolves.toBeNull();
    await expect(runs.list()).resolves.toMatchObject([
      { id: "legacy-run" },
      { id: "project-run", workflowStorage: { source: "project-store" } },
    ]);
  });

  it("does not silently relocate a record when its recorded store is unavailable", async () => {
    await expect(store().save(run("unavailable", "workflows:host:missing"))).rejects.toThrow(
      "Recorded store is unavailable",
    );
    await expect(new RunStore(legacyDirectory).get("unavailable")).resolves.toBeNull();
  });

  it("preserves colliding copies and surfaces a repairable collision", async () => {
    await new RunStore(repositoryRunsDirectory).save(
      run("collision", "workflows:repository:project_1"),
    );
    await new RunStore(hostRunsDirectory).save(run("collision", "workflows:host:project_1"));

    await expect(store().list()).resolves.toMatchObject([
      {
        id: "collision",
        status: "failed",
        error: expect.stringContaining("collision"),
      },
    ]);
    await expect(new RunStore(repositoryRunsDirectory).get("collision")).resolves.not.toBeNull();
    await expect(new RunStore(hostRunsDirectory).get("collision")).resolves.not.toBeNull();
  });
});
