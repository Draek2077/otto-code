import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { ArtifactStore } from "./artifact-store.js";
import { ArtifactStoreRegistry } from "./artifact-store-registry.js";
import { ArtifactStoreResolver } from "./artifact-store-resolver.js";

function metadata(id: string, projectId: string, filePath: string): ArtifactMetadata {
  return {
    id,
    name: id,
    description: "test",
    projectId,
    filePath,
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    errorMessage: null,
  };
}

describe("ArtifactStoreRegistry", () => {
  let root: string;
  let repoProject: string;
  let hostProject: string;
  let legacyDirectory: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "artifact-store-registry-"));
    repoProject = path.join(root, "repository-project");
    hostProject = path.join(root, "host-project");
    legacyDirectory = path.join(root, "legacy", ".otto", "artifacts");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function registry(): ArtifactStoreRegistry {
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join(root, "otto-home"),
      findProjectByRoot: async (projectRoot) => ({
        projectId: projectRoot,
        rootPath: projectRoot,
        displayName: path.basename(projectRoot),
        customName: null,
        projectKey: null,
        artifactLocation:
          path.resolve(projectRoot) === path.resolve(hostProject) ? "host" : "repository",
        artifactDirectoryName: `${path.basename(projectRoot)}-1234`,
      }),
      persistDirectoryName: async () => undefined,
      defaultLocation: () => "repository",
      logger: pino({ enabled: false }),
    });
    return new ArtifactStoreRegistry({
      resolver,
      resolveProjectRoot: async (cwd) => path.resolve(cwd),
      listProjectRoots: async () => [repoProject, hostProject],
      legacyArtifactsDirectory: legacyDirectory,
    });
  }

  it("routes repository and host projects to distinct ownership-derived stores", async () => {
    const stores = registry();
    const repository = await stores.resolveForProject(repoProject);
    const host = await stores.resolveForProject(hostProject);

    await repository.store.create(
      metadata(
        "repository-artifact",
        repoProject,
        repository.store.htmlPath("repository-artifact"),
      ),
    );
    await host.store.create(
      metadata("host-artifact", hostProject, host.store.htmlPath("host-artifact")),
    );

    await expect(stores.list(repoProject)).resolves.toMatchObject([{ id: "repository-artifact" }]);
    await expect(stores.list(hostProject)).resolves.toMatchObject([{ id: "host-artifact" }]);
    await expect(stores.find("host-artifact")).resolves.toMatchObject({
      location: { location: "host", projectRoot: path.resolve(hostProject) },
    });
  });

  it("keeps the legacy bucket discoverable without writing new project directories", async () => {
    const stores = registry();
    const legacy = new ArtifactStore(legacyDirectory);
    await legacy.create(
      metadata("legacy-artifact", repoProject, legacy.htmlPath("legacy-artifact")),
    );

    await expect(stores.list()).resolves.toMatchObject([{ id: "legacy-artifact" }]);
    await expect(stores.find("legacy-artifact")).resolves.toMatchObject({
      location: { artifactsDirectory: path.resolve(legacyDirectory) },
    });
    await expect(stat(path.join(hostProject, ".otto", "artifacts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stamps the store location onto project records that predate the field", async () => {
    const stores = registry();
    const repository = await stores.resolveForProject(repoProject);
    await repository.store.create(
      metadata("pre-0-9-artifact", repoProject, repository.store.htmlPath("pre-0-9-artifact")),
    );
    const legacy = new ArtifactStore(legacyDirectory);
    await legacy.create(
      metadata("legacy-artifact", repoProject, legacy.htmlPath("legacy-artifact")),
    );

    const listed = await stores.list(repoProject);
    expect(listed.find((artifact) => artifact.id === "pre-0-9-artifact")?.storageLocation).toBe(
      "repository",
    );
    expect(
      listed.find((artifact) => artifact.id === "legacy-artifact")?.storageLocation,
    ).toBeUndefined();
  });

  it("never persists a host directory name while listing a repository project", async () => {
    const persisted: string[] = [];
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join(root, "otto-home"),
      findProjectByRoot: async (projectRoot) => ({
        projectId: projectRoot,
        rootPath: projectRoot,
        displayName: path.basename(projectRoot),
        customName: null,
        projectKey: null,
        artifactLocation: "repository",
        artifactDirectoryName: null,
      }),
      persistDirectoryName: async ({ directoryName }) => {
        persisted.push(directoryName);
      },
      defaultLocation: () => "repository",
      logger: pino({ enabled: false }),
    });
    const stores = new ArtifactStoreRegistry({
      resolver,
      resolveProjectRoot: async (cwd) => path.resolve(cwd),
      listProjectRoots: async () => [repoProject],
      legacyArtifactsDirectory: legacyDirectory,
    });

    await stores.list();
    await stores.list(repoProject);
    await stores.find("missing-artifact");

    expect(persisted).toEqual([]);
  });
});
