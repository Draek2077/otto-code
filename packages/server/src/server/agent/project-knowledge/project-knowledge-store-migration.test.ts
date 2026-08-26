import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { moveProjectKnowledgeStore, storeHasPages } from "./project-knowledge-store-migration.js";
import {
  HOST_STORE_MARKER_FILE,
  hostKnowledgeStore,
  repositoryKnowledgeStore,
} from "./project-knowledge-store.js";

const logger = { warn: () => undefined } as never;

async function withTemp(run: (paths: { ottoHome: string; root: string }) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), "otto-knowledge-move-"));
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
  const knowledge = path.join(root, ".otto", "knowledge", "decisions");
  await mkdir(knowledge, { recursive: true });
  await writeFile(path.join(root, ".otto", "KNOWLEDGE.md"), "# Policy\n", "utf8");
  await writeFile(path.join(knowledge, "one.md"), "# One\n", "utf8");
  await writeFile(path.join(knowledge, "two.md"), "# Two\n", "utf8");
  await writeFile(path.join(root, ".otto", "knowledge", "index.md"), "# Index\n", "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("moveProjectKnowledgeStore", () => {
  it("carries every page across and leaves no Otto files in the working tree", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      await seedRepositoryStore(root);
      const from = repositoryKnowledgeStore(root);
      const to = hostKnowledgeStore({
        projectRoot: root,
        ottoHome,
        directoryName: "repo-abcd1234",
      });

      const result = await moveProjectKnowledgeStore({ from, to, logger });

      // KNOWLEDGE.md, index.md and the two decision pages.
      expect(result.movedPageCount).toBe(4);
      expect(await readFile(path.join(to.base, "KNOWLEDGE.md"), "utf8")).toBe("# Policy\n");
      expect(await readFile(path.join(to.base, "knowledge", "decisions", "two.md"), "utf8")).toBe(
        "# Two\n",
      );
      expect(await exists(path.join(root, ".otto"))).toBe(false);
    });
  });

  it("moves back to the repository just as completely", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const host = hostKnowledgeStore({
        projectRoot: root,
        ottoHome,
        directoryName: "repo-abcd1234",
      });
      await mkdir(path.join(host.base, "knowledge", "findings"), { recursive: true });
      await writeFile(path.join(host.base, "knowledge", "findings", "f.md"), "# F\n", "utf8");
      await writeFile(path.join(host.base, HOST_STORE_MARKER_FILE), "{}", "utf8");

      const repository = repositoryKnowledgeStore(root);
      const result = await moveProjectKnowledgeStore({ from: host, to: repository, logger });

      expect(result.movedPageCount).toBe(1);
      expect(
        await readFile(path.join(root, ".otto", "knowledge", "findings", "f.md"), "utf8"),
      ).toBe("# F\n");
      // The marker names the store, not its contents, so it never travels.
      expect(await exists(path.join(root, ".otto", HOST_STORE_MARKER_FILE))).toBe(false);
      expect(await exists(host.base)).toBe(false);
    });
  });

  it("is a no-op when the source holds nothing", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const from = repositoryKnowledgeStore(root);
      const to = hostKnowledgeStore({
        projectRoot: root,
        ottoHome,
        directoryName: "repo-abcd1234",
      });
      const result = await moveProjectKnowledgeStore({ from, to, logger });
      expect(result).toEqual({ movedPageCount: 0, sourceWasEmpty: true });
    });
  });

  it("does not treat a bare host marker as pages worth moving", async () => {
    await withTemp(async ({ ottoHome, root }) => {
      const host = hostKnowledgeStore({
        projectRoot: root,
        ottoHome,
        directoryName: "repo-abcd1234",
      });
      await mkdir(host.base, { recursive: true });
      await writeFile(path.join(host.base, HOST_STORE_MARKER_FILE), "{}", "utf8");
      expect(await storeHasPages(host)).toBe(false);
    });
  });

  it("reports pages present at a store the user has not switched to yet", async () => {
    await withTemp(async ({ root }) => {
      await seedRepositoryStore(root);
      expect(await storeHasPages(repositoryKnowledgeStore(root))).toBe(true);
    });
  });
});
