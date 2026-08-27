import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectKnowledgeStore } from "../agent/project-knowledge/project-knowledge-store.js";
import { ArtifactStoreResolver } from "./artifact-store-resolver.js";

function repositoryKnowledgeStore(projectRoot: string): ProjectKnowledgeStore {
  return {
    location: "repository",
    projectRoot,
    base: path.join(projectRoot, ".otto"),
    pathBase: projectRoot,
  };
}

function hostKnowledgeStore(projectRoot: string, ottoHome: string): ProjectKnowledgeStore {
  const directoryName = "otto-code-a1b2c3d4";
  const base = path.join(ottoHome, "project-knowledge", directoryName);
  return {
    location: "host",
    projectRoot,
    base,
    pathBase: base,
  };
}

describe("ArtifactStoreResolver", () => {
  it("keeps repository-owned artifacts in the project .otto directory", async () => {
    const root = path.join("C:", "repos", "otto-code");
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join("C:", "otto-home"),
      resolveKnowledgeStore: async () => repositoryKnowledgeStore(root),
    });

    await expect(resolver.resolveForProjectRoot(root)).resolves.toEqual({
      location: "repository",
      projectRoot: path.resolve(root),
      artifactsDirectory: path.join(root, ".otto", "artifacts"),
    });
  });

  it("uses the knowledge resolver's stable project identity for host-local artifacts", async () => {
    const root = path.join("C:", "repos", "otto-code");
    const ottoHome = path.join("C:", "otto-home");
    const resolver = new ArtifactStoreResolver({
      ottoHome,
      resolveKnowledgeStore: async () => hostKnowledgeStore(root, ottoHome),
    });

    await expect(resolver.resolveForProjectRoot(root)).resolves.toEqual({
      location: "host",
      projectRoot: path.resolve(root),
      artifactsDirectory: path.join(ottoHome, "project-artifacts", "otto-code-a1b2c3d4"),
    });
  });

  it("does not trust a caller's relative spelling of the project root", async () => {
    const root = path.join("C:", "repos", "otto-code");
    let resolvedRoot: string | null = null;
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join("C:", "otto-home"),
      resolveKnowledgeStore: async (projectRoot) => {
        resolvedRoot = projectRoot;
        return repositoryKnowledgeStore(projectRoot);
      },
    });

    await resolver.resolveForProjectRoot(path.join(root, "..", "otto-code"));

    expect(resolvedRoot).toBe(path.resolve(root));
  });
});
