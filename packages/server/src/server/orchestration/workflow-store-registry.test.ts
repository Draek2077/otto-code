import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CategoryStorageResolver } from "../category-storage/category-storage-resolver.js";
import {
  WORKFLOW_HOST_STORE_ROOT_DIRECTORY,
  WorkflowStoreRegistry,
  type WorkflowStorageProjectRecord,
} from "./workflow-store-registry.js";

describe("WorkflowStoreRegistry", () => {
  let root: string;
  let ottoHome: string;
  let project: WorkflowStorageProjectRecord;
  let defaultLocation: "repository" | "host";
  let failDirectoryPersistence: boolean;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-store-registry-"));
    ottoHome = path.join(root, "otto-home");
    project = {
      projectId: "project_1",
      rootPath: path.join(root, "project"),
      displayName: "Workflow Project",
      customName: null,
      projectKey: "github.com/example/workflow-project",
      workflowLocation: null,
      workflowDirectoryName: null,
    };
    defaultLocation = "repository";
    failDirectoryPersistence = false;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function registry(): WorkflowStoreRegistry {
    return new WorkflowStoreRegistry({
      resolver: new CategoryStorageResolver({
        category: "workflows",
        repositoryDirectory: "workflows",
        hostRootDirectory: WORKFLOW_HOST_STORE_ROOT_DIRECTORY,
        ottoHome,
        hostId: "host_1",
        hostName: "build-host",
        findProjectByRoot: async (projectRoot) =>
          path.resolve(projectRoot) === path.resolve(project.rootPath) ? project : null,
        projectLocation: (record) => record.workflowLocation,
        projectDirectoryName: (record) => record.workflowDirectoryName,
        persistDirectoryName: async ({ directoryName }) => {
          if (failDirectoryPersistence) throw new Error("disk temporarily unavailable");
          project = { ...project, workflowDirectoryName: directoryName };
        },
        defaultLocation: () => defaultLocation,
        logger: pino({ enabled: false }),
      }),
      // A worktree must resolve to its main project root before the repository
      // location is constructed.
      resolveProjectRoot: async () => project.rootPath,
      legacy: {
        runsDirectory: path.join(ottoHome, "runs"),
        definitionsDirectory: path.join(ottoHome, "orchestration-graphs"),
        templatesDirectory: path.join(ottoHome, "prompt-templates"),
      },
    });
  }

  it("gives a project Workflow override precedence over the independent host default", async () => {
    defaultLocation = "host";
    project = { ...project, workflowLocation: "repository" };

    await expect(registry().resolveForProjectRoot(project.rootPath)).resolves.toMatchObject({
      location: "repository",
      definitionsDirectory: path.join(project.rootPath, ".otto", "workflows", "definitions"),
      templatesDirectory: path.join(project.rootPath, ".otto", "workflows", "templates"),
      runsDirectory: path.join(project.rootPath, ".otto", "workflows", "runs"),
    });
  });

  it("keeps an existing repository Workflow library selected before a host default", async () => {
    defaultLocation = "host";
    await mkdir(path.join(project.rootPath, ".otto", "workflows"), { recursive: true });

    await expect(registry().resolveForProjectRoot(project.rootPath)).resolves.toMatchObject({
      location: "repository",
    });
  });

  it("uses the main project identity for a worktree and persists a host-local key", async () => {
    defaultLocation = "host";

    const location = await registry().resolveForCwd(path.join(root, "worktrees", "feature"));

    expect(location.projectRoot).toBe(path.resolve(project.rootPath));
    expect(location.baseDirectory).toBe(
      path.join(ottoHome, WORKFLOW_HOST_STORE_ROOT_DIRECTORY, project.workflowDirectoryName!),
    );
    expect(location.storeKey).toBe("workflows:host:key:github.com/example/workflow-project");
    expect(location.storeKey).not.toContain(location.baseDirectory);
    expect(project.workflowDirectoryName).not.toBeNull();
    expect(registry().provenanceFor(location)).toEqual({
      schemaVersion: 1,
      projectRoot: path.resolve(project.rootPath),
      projectId: "project_1",
      projectKey: "github.com/example/workflow-project",
      location: "host",
      storeKey: location.storeKey,
      hostId: "host_1",
      hostName: "build-host",
      source: "project-store",
    });
  });

  it("discovers the alternate project location and legacy host library without moving either", async () => {
    const discovery = await registry().discoverForProjectRoot(project.rootPath);

    expect(discovery.selected.location).toBe("repository");
    expect(discovery.alternate.location).toBe("host");
    expect(discovery.legacy).toEqual({
      runsDirectory: path.join(ottoHome, "runs"),
      definitionsDirectory: path.join(ottoHome, "orchestration-graphs"),
      templatesDirectory: path.join(ottoHome, "prompt-templates"),
    });
    expect(registry().legacyProvenanceFor(project.rootPath)).toMatchObject({
      source: "legacy-host-library",
      projectRoot: path.resolve(project.rootPath),
    });
  });

  it("keeps a deterministic recoverable host location when directory-key persistence fails", async () => {
    defaultLocation = "host";
    failDirectoryPersistence = true;
    const stores = registry();

    const first = await stores.resolveForProjectRoot(project.rootPath);
    const second = await stores.resolveForProjectRoot(project.rootPath);

    expect(first.baseDirectory).toBe(second.baseDirectory);
    expect(first.storeKey).toBe(second.storeKey);
    expect(project.workflowDirectoryName).toBeNull();
  });

  it("keeps path-based foundation keys readable without emitting them again", async () => {
    const stores = registry();
    const location = await stores.resolveForProjectRoot(project.rootPath);

    await expect(
      stores.resolveRecordedStore({
        projectRoot: project.rootPath,
        storeKey: location.legacyStoreKeys[0]!,
      }),
    ).resolves.toMatchObject({ storeKey: location.storeKey });
  });
});
