import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStoreResolver } from "./artifact-store-resolver.js";

function resolverFor(input: {
  root: string;
  ottoHome: string;
  location?: "repository" | "host" | null;
  defaultLocation?: "repository" | "host";
}) {
  const project = {
    projectId: "prj_1",
    rootPath: input.root,
    displayName: "Otto Code",
    customName: null,
    projectKey: "github.com/otto-code",
    artifactLocation: input.location ?? null,
    artifactDirectoryName: "otto-code-a1b2c3d4",
  };
  return new ArtifactStoreResolver({
    ottoHome: input.ottoHome,
    findProjectByRoot: async () => project,
    persistDirectoryName: async () => undefined,
    defaultLocation: () => input.defaultLocation ?? "repository",
    logger: pino({ enabled: false }),
  });
}

describe("ArtifactStoreResolver", () => {
  let fixtureRoot: string;
  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "artifact-store-resolver-"));
  });
  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });
  it("keeps repository-owned artifacts in the project .otto directory", async () => {
    const root = path.join(fixtureRoot, "repos", "otto-code");
    const resolver = resolverFor({ root, ottoHome: path.join(fixtureRoot, "otto-home") });

    await expect(resolver.resolveForProjectRoot(root)).resolves.toEqual({
      location: "repository",
      projectRoot: path.resolve(root),
      artifactsDirectory: path.join(root, ".otto", "artifacts"),
    });
  });

  it("uses its own project override and stable artifact identity for host-local artifacts", async () => {
    const root = path.join(fixtureRoot, "repos", "otto-code");
    const ottoHome = path.join(fixtureRoot, "otto-home");
    const resolver = resolverFor({ root, ottoHome, location: "host" });

    await expect(resolver.resolveForProjectRoot(root)).resolves.toEqual({
      location: "host",
      projectRoot: path.resolve(root),
      artifactsDirectory: path.join(ottoHome, "project-artifacts", "otto-code-a1b2c3d4"),
    });
  });

  it("does not trust a caller's relative spelling of the project root", async () => {
    const root = path.join(fixtureRoot, "repos", "otto-code");
    let resolvedRoot: string | null = null;
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join(fixtureRoot, "otto-home"),
      findProjectByRoot: async (projectRoot) => {
        resolvedRoot = projectRoot;
        return null;
      },
      persistDirectoryName: async () => undefined,
      defaultLocation: () => "repository",
      logger: pino({ enabled: false }),
    });

    await resolver.resolveForProjectRoot(path.relative(process.cwd(), root));

    expect(resolvedRoot).toBe(path.resolve(root));
  });

  it("keeps an existing repository artifact store visible when the host default changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-store-resolver-"));
    try {
      await mkdir(path.join(root, ".otto", "artifacts"), { recursive: true });
      await writeFile(path.join(root, ".otto", "artifacts", "abc123.json"), "{}", "utf-8");
      const resolver = resolverFor({
        root,
        ottoHome: path.join(root, "otto-home"),
        defaultLocation: "host",
      });

      await expect(resolver.resolveForProjectRoot(root)).resolves.toMatchObject({
        location: "repository",
        artifactsDirectory: path.join(root, ".otto", "artifacts"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores an empty repository artifact directory left by an older daemon", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-store-resolver-"));
    try {
      await mkdir(path.join(root, ".otto", "artifacts"), { recursive: true });
      const ottoHome = path.join(root, "otto-home");
      const resolver = resolverFor({ root, ottoHome, defaultLocation: "host" });

      await expect(resolver.resolveForProjectRoot(root)).resolves.toMatchObject({
        location: "host",
        artifactsDirectory: path.join(ottoHome, "project-artifacts", "otto-code-a1b2c3d4"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adopts a pre-0.9 host directory filed under the Knowledge directory name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-store-resolver-"));
    try {
      const ottoHome = path.join(root, "otto-home");
      const inherited = path.join(ottoHome, "project-artifacts", "otto-code-a1b2c3d4-2");
      await mkdir(inherited, { recursive: true });
      const persisted: string[] = [];
      const resolver = new ArtifactStoreResolver({
        ottoHome,
        findProjectByRoot: async () => ({
          projectId: "prj_1",
          rootPath: root,
          displayName: "Otto Code",
          customName: null,
          projectKey: "github.com/otto-code",
          artifactLocation: "host",
          artifactDirectoryName: null,
          knowledgeDirectoryName: "otto-code-a1b2c3d4-2",
        }),
        persistDirectoryName: async ({ directoryName }) => {
          persisted.push(directoryName);
        },
        defaultLocation: () => "repository",
        logger: pino({ enabled: false }),
      });

      await expect(resolver.resolveForProjectRoot(root)).resolves.toMatchObject({
        location: "host",
        artifactsDirectory: inherited,
      });
      expect(persisted).toEqual(["otto-code-a1b2c3d4-2"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not persist a host directory name when only peeking at the host location", async () => {
    const root = path.join(fixtureRoot, "repos", "otto-code");
    const persisted: string[] = [];
    const resolver = new ArtifactStoreResolver({
      ottoHome: path.join(fixtureRoot, "otto-home"),
      findProjectByRoot: async () => ({
        projectId: "prj_1",
        rootPath: root,
        displayName: "Otto Code",
        customName: null,
        projectKey: null,
        artifactLocation: null,
        artifactDirectoryName: null,
      }),
      persistDirectoryName: async ({ directoryName }) => {
        persisted.push(directoryName);
      },
      defaultLocation: () => "repository",
      logger: pino({ enabled: false }),
    });

    const peeked = await resolver.storeAtLocation(root, "host", { persist: false });
    expect(peeked.location).toBe("host");
    expect(persisted).toEqual([]);

    const chosen = await resolver.storeAtLocation(root, "host");
    expect(chosen.artifactsDirectory).toBe(peeked.artifactsDirectory);
    expect(persisted).toHaveLength(1);
  });
});
