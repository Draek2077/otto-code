import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { KnowledgeService, KnowledgePurgeIncompleteError } from "./knowledge-service.js";
import { KnowledgeStoreResolver } from "./store-resolver.js";
import { KnowledgeRecordOperations } from "./record-operations.js";
import { removeWikiLinksTo } from "./links.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-purge/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  roots.push(root);
  let beforeRename: (() => Promise<void>) | null = null;
  const service = new KnowledgeService({
    resolver: new KnowledgeStoreResolver({
      ottoHome: root,
      defaultLocation: () => "repository",
      resolveProject: async (projectId) => ({ projectId, rootPath: root }),
    }),
    now: () => new Date("2026-10-24T18:00:00Z"),
    replacement: {
      openStagedFile: (file) => open(file, "wx", 0o600),
      renameFile: async (from, to) => {
        await beforeRename?.();
        await rename(from, to);
      },
    },
  });
  const target = { projectId: "project", kind: "requirement", id: "purged-page" } as const;
  const page = await service.createDraft({
    ...target,
    title: "Selected page",
    statement: "Permanently removed current truth",
    tags: [],
  });
  const file = page.absolutePath;
  const peerTarget = { projectId: "project", kind: "decision", id: "retained-page" } as const;
  const peer = await service.createDraft({
    ...peerTarget,
    title: "Retained page",
    statement:
      "See [[purged-page|Selected]] for details.\n\n- [[purged-page]]\n- [[purged-page#Heading]] · old\n- [[unrelated-page]]",
    tags: [],
  });
  const records = new KnowledgeRecordOperations(service);
  const confirmed = await records.review({
    ...peerTarget,
    expectedRevision: peer.revision,
    status: "confirmed",
    reason: "Approved original [[purged-page]] reference.",
  });
  const background = path.join(root, ".otto/knowledge/background.md");
  await service.writeRoot({
    projectId: "project",
    slug: "background",
    expectedRevision: null,
    body: "# Background\n\n- [[purged-page]]\n- [[unrelated-page]]\n",
  });
  return {
    root,
    service,
    target,
    page,
    file,
    peerTarget,
    confirmed,
    background,
    hook: (callback: () => Promise<void>) => {
      beforeRename = callback;
    },
  };
}
it("purges canonical history, repairs live links and preserves peer historical entries/review and unrelated files", async () => {
  const f = await fixture();
  const index = path.join(f.root, ".otto/knowledge/index.md");
  await writeFile(index, "# Index\n- [[purged-page]]\n- [[retained-page]]\n");
  const unrelated = path.join(f.root, ".otto/knowledge/notes.txt");
  await writeFile(unrelated, "Original bytes [[purged-page]]");
  const statement = f.confirmed.statement;
  await f.service.purge({
    ...f.target,
    expectedRevision: f.page.revision,
    reason: "Human approved removing this accidental fixture.",
  });
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  const peer = await f.service.read(f.peerTarget);
  expect(peer.statement).toBe("See for details.\n\n- old\n- [[unrelated-page]]");
  expect(peer.metadata.status).toBe("confirmed");
  expect(peer.timeline.startsWith(f.confirmed.timeline)).toBe(true);
  expect(peer.timeline).toContain("Approved original [[purged-page]] reference.");
  expect(peer.timeline).toContain("Human approved removing this accidental fixture.");
  expect(statement).toContain("[[purged-page");
  expect(await readFile(f.background, "utf8")).toBe("# Background\n\n- [[unrelated-page]]\n");
  expect(await readFile(index, "utf8")).not.toContain("[[purged-page]]");
  expect(await readFile(unrelated, "utf8")).toBe("Original bytes [[purged-page]]");
  expect((await f.service.catalog("project", true)).map((page) => page.id)).toEqual([
    "retained-page",
  ]);
});
it("refuses stale revision/empty reasons before repairing anything", async () => {
  const f = await fixture();
  const original = await readFile(f.confirmed.absolutePath);
  await expect(
    f.service.purge({ ...f.target, expectedRevision: "0".repeat(64), reason: "Approved" }),
  ).rejects.toThrow("changed");
  await expect(
    f.service.purge({ ...f.target, expectedRevision: f.page.revision, reason: "  " }),
  ).rejects.toThrow("empty");
  expect(await readFile(f.confirmed.absolutePath)).toEqual(original);
  expect(await f.service.read(f.target)).toMatchObject({ revision: f.page.revision });
});
it("preflights corrupt peer records without deleting or repairing files", async () => {
  const f = await fixture();
  const original = await readFile(f.background);
  await writeFile(f.confirmed.absolutePath, "Malformed preserved record");
  await expect(
    f.service.purge({ ...f.target, expectedRevision: f.page.revision, reason: "Approved" }),
  ).rejects.toThrow("Unsupported");
  expect(await readFile(f.background)).toEqual(original);
  expect((await f.service.read(f.target)).revision).toBe(f.page.revision);
});
it("retains the target on a partial repair failure, reports reconciliation and never retries a rename", async () => {
  const f = await fixture();
  let attempts = 0;
  f.hook(async () => {
    if (++attempts === 2) throw new Error("Injected fixture rename denial");
  });
  await expect(
    f.service.purge({ ...f.target, expectedRevision: f.page.revision, reason: "Approved" }),
  ).rejects.toBeInstanceOf(KnowledgePurgeIncompleteError);
  expect(attempts).toBe(2);
  expect((await f.service.read(f.target)).revision).toBe(f.page.revision);
  expect((await f.service.read(f.peerTarget)).statement).not.toContain("[[purged-page");
  expect(await readFile(f.background, "utf8")).toContain("[[purged-page]]");
});
it("revalidates the selected page after repairs rather than deleting a newer external edit", async () => {
  const f = await fixture();
  let edited = false;
  f.hook(async () => {
    if (edited) return;
    edited = true;
    const raw = await readFile(f.file, "utf8");
    await writeFile(
      f.file,
      raw.replace("Permanently removed current truth", "Newer external truth"),
    );
  });
  await expect(
    f.service.purge({ ...f.target, expectedRevision: f.page.revision, reason: "Approved" }),
  ).rejects.toBeInstanceOf(KnowledgePurgeIncompleteError);
  expect((await f.service.read(f.target)).statement).toBe("Newer external truth");
});
it("keeps exact target identity, untouched whitespace and unrelated wiki-links", () => {
  expect(
    removeWikiLinksTo("Untouched  spacing\n- [[target-suffix]]\n- [[targeted]]", "target"),
  ).toBe("Untouched  spacing\n- [[target-suffix]]\n- [[targeted]]");
  expect(
    removeWikiLinksTo(
      "1. [[target|Label]]\n2. [[ target #heading]]: Retained\nSee [[target]], then [[other]].",
      "target",
    ),
  ).toBe("2. Retained\nSee, then [[other]].");
});
