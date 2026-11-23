import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { KnowledgeService } from "./knowledge-service.js";
import { KnowledgeStoreResolver } from "./store-resolver.js";
import { KnowledgeRecordOperations } from "./record-operations.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-links/", import.meta.url));
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
  const service = new KnowledgeService({
    resolver: new KnowledgeStoreResolver({
      ottoHome: root,
      defaultLocation: () => "repository",
      resolveProject: async (projectId) => ({ projectId, rootPath: root }),
    }),
    now: () => new Date("2026-10-24T19:00:00Z"),
  });
  const records = new KnowledgeRecordOperations(service);
  async function page(
    id: string,
    statement: string,
    status: "confirmed" | "proposed" | "superseded" = "confirmed",
  ) {
    const target = { projectId: "project", kind: "requirement", id } as const;
    const created = await service.createDraft({ ...target, title: id, statement });
    if (status === "proposed") return created;
    return records.review({
      ...target,
      expectedRevision: created.revision,
      status,
      reason: "Explicit fixture review with [[historical-only]] evidence.",
    });
  }
  return { root, service, page };
}

it("checks confirmed truth and roots against active conclusions, ignoring timelines and inactive sources", async () => {
  const f = await fixture();
  await f.page("active", "Self [[active]]");
  await f.page("draft", "[[ignored-draft-source]]", "proposed");
  await f.page("history", "[[ignored-history-source]]", "superseded");
  const source = await f.page(
    "source",
    "[[ active |alias]] [[active#Heading]] [[draft]] [[history]] [[missing|Alias]] [[missing#Heading]]",
  );
  await f.service.writeRoot({
    projectId: "project",
    slug: "background",
    expectedRevision: null,
    body: "# Background\n[[missing-root]] [[active]]",
  });
  const issues = await f.service.linkHealth("project");
  expect(
    issues.map(({ source: from, target }) => [from.type === "page" ? from.id : from.slug, target]),
  ).toEqual([
    ["background", "missing-root"],
    ["source", "draft"],
    ["source", "history"],
    ["source", "missing"],
  ]);
  expect(issues[1].source).toEqual({
    type: "page",
    kind: "requirement",
    id: "source",
    revision: source.revision,
  });
  expect(issues[0].source).toMatchObject({
    type: "root",
    slug: "background",
    revision: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

it("preserves every source byte and reports a fresh result after an external edit", async () => {
  const f = await fixture();
  const source = await f.page("source", "[[absent]]");
  const before = await readFile(source.absolutePath);
  expect(await f.service.linkHealth("project")).toHaveLength(1);
  expect(await readFile(source.absolutePath)).toEqual(before);
  await writeFile(source.absolutePath, before.toString("utf8").replace("[[absent]]", "[[source]]"));
  expect(await f.service.linkHealth("project")).toEqual([]);
});

it("does not initialize an absent store and refuses malformed records rather than reporting false health", async () => {
  const f = await fixture();
  expect(await f.service.linkHealth("project")).toEqual([]);
  await expect(readFile(path.join(f.root, ".otto/knowledge/index.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const source = await f.page("source", "Original");
  await writeFile(source.absolutePath, "Malformed preserved record [[missing]]");
  await expect(f.service.linkHealth("project")).rejects.toThrow();
  expect(await readFile(source.absolutePath, "utf8")).toBe(
    "Malformed preserved record [[missing]]",
  );
});

it("refuses oversized link metadata without truncation or source mutation", async () => {
  const f = await fixture();
  const source = await f.page("source", `[[${"x".repeat(513)}]]`);
  const before = await readFile(source.absolutePath);
  await expect(f.service.linkHealth("project")).rejects.toThrow("inspection limit");
  expect(await readFile(source.absolutePath)).toEqual(before);
});
