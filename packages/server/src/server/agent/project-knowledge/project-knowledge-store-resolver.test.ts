import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  ProjectKnowledgeStoreResolver,
  type ProjectKnowledgeProjectRecord,
  type ProjectKnowledgeStoreResolverDeps,
} from "./project-knowledge-store-resolver.js";
import { HOST_STORE_MARKER_FILE, deriveKnowledgeDirectoryName } from "./project-knowledge-store.js";

const logger = { warn: () => undefined } as never;

interface Harness {
  resolver: ProjectKnowledgeStoreResolver;
  project: ProjectKnowledgeProjectRecord | null;
  persisted: { projectId: string; directoryName: string }[];
}

function harness(input: {
  ottoHome: string;
  root: string;
  project?: Partial<ProjectKnowledgeProjectRecord> | null;
  defaultLocation?: "repository" | "host";
}): Harness {
  const persisted: { projectId: string; directoryName: string }[] = [];
  const state: { project: ProjectKnowledgeProjectRecord | null } = {
    project:
      input.project === null
        ? null
        : {
            projectId: "prj_1",
            rootPath: input.root,
            displayName: "Otto Code",
            customName: null,
            projectKey: null,
            knowledgeLocation: null,
            knowledgeDirectoryName: null,
            ...input.project,
          },
  };
  const deps: ProjectKnowledgeStoreResolverDeps = {
    ottoHome: input.ottoHome,
    resolveProjectRoot: async (cwd) => cwd,
    findProjectByRoot: async () => state.project,
    persistDirectoryName: async (entry) => {
      persisted.push(entry);
      if (state.project)
        state.project = { ...state.project, knowledgeDirectoryName: entry.directoryName };
    },
    defaultLocation: () => input.defaultLocation ?? "repository",
    logger,
  };
  return { resolver: new ProjectKnowledgeStoreResolver(deps), project: state.project, persisted };
}

async function withTemp(run: (paths: { ottoHome: string; root: string }) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), "otto-knowledge-store-"));
  const ottoHome = path.join(base, "home");
  const root = path.join(base, "repo");
  await mkdir(ottoHome, { recursive: true });
  await mkdir(root, { recursive: true });
  try {
    await run({ ottoHome, root });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function seedRepositoryStore(root: string): Promise<void> {
  await mkdir(path.join(root, ".otto", "knowledge"), { recursive: true });
  await writeFile(path.join(root, ".otto", "knowledge", "index.md"), "# Index\n", "utf8");
}

describe("ProjectKnowledgeStoreResolver", () => {
  it("keeps a project in the repository by default", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const { resolver } = harness({ ottoHome, root });
      const store = await resolver.resolveForRoot(root);
      expect(store.location).toBe("repository");
      expect(store.base).toBe(path.join(root, ".otto"));
    });
  });

  it("sends a project with no store to the host when that is the host default", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const { resolver } = harness({ ottoHome, root, defaultLocation: "host" });
      const store = await resolver.resolveForRoot(root);
      expect(store.location).toBe("host");
      expect(store.base.startsWith(path.join(ottoHome, "project-knowledge"))).toBe(true);
    });
  });

  it("leaves an existing repository store where it is under a host default", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      await seedRepositoryStore(root);
      const { resolver } = harness({ ottoHome, root, defaultLocation: "host" });
      expect((await resolver.resolveForRoot(root)).location).toBe("repository");
    });
  });

  it("lets a project override outrank both the existing store and the host default", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      await seedRepositoryStore(root);
      const { resolver } = harness({
        ottoHome,
        root,
        project: { knowledgeLocation: "host" },
        defaultLocation: "repository",
      });
      expect((await resolver.resolveForRoot(root)).location).toBe("host");
    });
  });

  it("persists the host directory name so a renamed project keeps its store", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const { resolver, persisted } = harness({
        ottoHome,
        root,
        project: { knowledgeLocation: "host", displayName: "Otto Code" },
      });
      const first = await resolver.resolveForRoot(root);
      expect(persisted).toHaveLength(1);
      // A later resolve reads the persisted name rather than re-deriving from
      // the (now different) display name.
      const second = await resolver.resolveForRoot(root);
      expect(second.base).toBe(first.base);
      expect(persisted).toHaveLength(1);
    });
  });

  it("derives one directory per identity, and reuses it for a second clone of the same remote", async () => {
    const remote = deriveKnowledgeDirectoryName({
      displayName: "Otto Code",
      projectKey: "remote:github.com/draek2077/otto-code",
      rootPath: "/a",
    });
    const otherClone = deriveKnowledgeDirectoryName({
      displayName: "Otto Code",
      projectKey: "remote:github.com/draek2077/otto-code",
      rootPath: "/b",
    });
    expect(remote).toBe(otherClone);
    expect(remote).toMatch(/^otto-code-[0-9a-f]{8}$/u);
  });

  it("writes a marker naming the project the host store belongs to", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const { resolver } = harness({ ottoHome, root, project: { knowledgeLocation: "host" } });
      const store = await resolver.resolveForRoot(root);
      await resolver.ensureHostStoreMarker(store);
      const marker = JSON.parse(
        await readFile(path.join(store.base, HOST_STORE_MARKER_FILE), "utf8"),
      );
      expect(marker.rootPath).toBe(root);
      expect(marker.projectId).toBe("prj_1");
    });
  });

  it("resolves a store for an unregistered directory without a project record", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const { resolver } = harness({ ottoHome, root, project: null, defaultLocation: "host" });
      const store = await resolver.resolveForRoot(root);
      expect(store.location).toBe("host");
      // No projectId to persist against, but the derivation is deterministic so
      // the same directory resolves again on the next call.
      expect((await resolver.resolveForRoot(root)).base).toBe(store.base);
    });
  });
});
