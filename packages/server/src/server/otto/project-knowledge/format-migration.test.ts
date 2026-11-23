import { mkdir, mkdtemp, readFile, readdir, rename, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createDraftPage, digest, parseKnowledgePage } from "./markdown-page.js";
import { convertLegacyJson, convertLegacyMarkdown } from "./legacy-format.js";
import { applyKnowledgeFormat, inspectKnowledgeFormat } from "./format-migration.js";
import { KnowledgeStoreResolver } from "./store-resolver.js";
import { KnowledgeService } from "./knowledge-service.js";
import { withKnowledgeWrite } from "./knowledge-files.js";
import { knowledgeCatalogPrompt } from "./catalog-prompt.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-format/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
const time = "2026-10-24T20:00:00.000Z";
const oldTime = "2026-01-02T03:04:05.000Z";
function record(id = "json-page") {
  return {
    id,
    kind: "requirement",
    title: "Retained legacy title",
    statement: "Legacy truth [[other-page]]",
    evidence: "Retained separate evidence",
    status: "confirmed",
    tags: ["legacy"],
    createdAt: oldTime,
    updatedAt: oldTime,
    future: { retained: true },
    provenance: [
      {
        kind: "custom-event",
        text: "Original history",
        recordedAt: oldTime,
        source: "original source",
        extra: { keep: true },
      },
    ],
  };
}
function legacyMarkdown(id = "old-page") {
  return `---\nid: ${id}\nkind: requirement\ntitle: Old article\nstatus: confirmed\ntags: [legacy]\ncreated_at: ${JSON.stringify(oldTime)}\nupdated_at: ${JSON.stringify(oldTime)}\n# Retained YAML comment\nfuture: { retained: true }\n---\n# Old article\n\n## Current truth\n\nOriginal truth\n\n~~~md\n## Timeline\n~~~\n\n## Evidence\n\nRich **evidence**\n\n## Timeline\n\n- ${oldTime} [custom-event] Retained prior history (source: original source)\n`;
}
async function fixture(location: "repository" | "host" = "repository") {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  await mkdir(repo);
  await mkdir(home);
  const resolver = new KnowledgeStoreResolver({
    ottoHome: home,
    defaultLocation: () => "repository",
    resolveProject: async (projectId) => ({
      projectId,
      rootPath: repo,
      knowledgeLocation: location,
      knowledgeDirectoryName: "persisted-project",
    }),
  });
  const store = await resolver.resolve("project");
  const context = async () => ({ store, projectRevision: "project-revision" });
  const service = new KnowledgeService({ resolver, now: () => new Date(time) });
  const writeJson = async (records = [record()]) => {
    await mkdir(path.join(repo, ".otto"), { recursive: true });
    const file = path.join(repo, ".otto/project-knowledge.json");
    const raw =
      JSON.stringify({ version: 1, records, futureEnvelope: { retained: true } }, null, 2) + "\r\n";
    await writeFile(file, raw);
    return { file, raw };
  };
  const writeMarkdown = async (id = "old-page") => {
    const file = path.join(store.base, "knowledge/requirements", `${id}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    const raw = legacyMarkdown(id).replace(/\n/g, "\r\n");
    await writeFile(file, raw);
    return { file, raw };
  };
  const apply = (expectedRevision: string) =>
    applyKnowledgeFormat({
      context,
      expectedRevision,
      reason: "Human confirmed the inspected conversion",
      now: () => new Date(time),
    });
  return { repo, home, store, context, service, writeJson, writeMarkdown, apply };
}

it.each(["repository", "host"] as const)(
  "previews without writes then converts both frozen formats with byte recovery in %s storage",
  async (location) => {
    const f = await fixture(location);
    const md = await f.writeMarkdown();
    const json = await f.writeJson();
    const rootFile = path.join(f.store.base, "knowledge/background.md");
    await writeFile(rootFile, "# Authored root\r\n\r\nOriginal\r\n");
    const indexFile = path.join(f.store.base, "knowledge/index.md");
    await writeFile(indexFile, "# Authored index\r\nOriginal index bytes\r\n");
    const first = await inspectKnowledgeFormat(await f.context());
    expect(first).toMatchObject({ required: true, count: 2, omitted: 0 });
    expect(await readFile(md.file, "utf8")).toBe(md.raw);
    await expect(readdir(path.join(f.store.base, "knowledge-recovery"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await f.apply(first.revision)).toMatchObject({
      converted: 2,
      recoveryPath: first.recoveryPath,
    });
    const converted = await f.service.read({
      projectId: "project",
      kind: "requirement",
      id: "old-page",
    });
    expect(converted.metadata).toMatchObject({
      status: "confirmed",
      future: { retained: true },
      created_at: oldTime,
      updated_at: oldTime,
    });
    expect(converted.statement).toContain("~~~md\n## Timeline\n~~~");
    expect(converted.timeline).toContain("custom-event");
    expect(converted.timeline).toContain("Rich **evidence**");
    expect(await readFile(md.file, "utf8")).toContain("# Retained YAML comment");
    const imported = await f.service.read({
      projectId: "project",
      kind: "requirement",
      id: "json-page",
    });
    expect(imported.metadata.future).toEqual({ retained: true });
    expect(imported.timeline).toContain("Original history");
    expect(imported.timeline).toContain("Retained separate evidence");
    expect(imported.timeline).toContain("extra:");
    expect(
      await readFile(
        path.join(first.recoveryPath, "store/knowledge/requirements/old-page.md"),
        "utf8",
      ),
    ).toBe(md.raw);
    expect(
      await readFile(path.join(first.recoveryPath, "repository/project-knowledge.json"), "utf8"),
    ).toBe(json.raw);
    expect(await readFile(json.file, "utf8")).toBe(json.raw);
    expect(await readFile(rootFile, "utf8")).toBe("# Authored root\r\n\r\nOriginal\r\n");
    expect(await readFile(indexFile, "utf8")).toBe("# Authored index\r\nOriginal index bytes\r\n");
    expect(await inspectKnowledgeFormat(await f.context())).toMatchObject({
      required: false,
      count: 0,
    });
  },
);

it("does not initialize an empty project on inspection or change host-default resolution", async () => {
  const f = await fixture("host");
  expect(await inspectKnowledgeFormat(await f.context())).toMatchObject({ required: false });
  expect(await readdir(f.repo)).toEqual([]);
  expect(await readdir(f.home)).toEqual([]);
  const json = await f.writeJson();
  const plan = await inspectKnowledgeFormat(await f.context());
  await f.apply(plan.revision);
  expect(await readdir(path.join(f.repo, ".otto"))).toEqual(["project-knowledge.json"]);
  expect(await readFile(json.file, "utf8")).toBe(json.raw);
  expect(await knowledgeCatalogPrompt(f.service, f.store)).toContain("[[json-page]]");
});

it("resumes interrupted index finalization without replacing a converted page or its original recovery", async () => {
  const f = await fixture();
  const md = await f.writeMarkdown();
  const plan = await inspectKnowledgeFormat(await f.context());
  let denied = 0;
  await expect(
    applyKnowledgeFormat({
      context: f.context,
      expectedRevision: plan.revision,
      reason: "Approved fixture",
      now: () => new Date(time),
      replacement: {
        openStagedFile: async (file) => {
          if (path.basename(file).startsWith(".index.md.")) {
            denied++;
            throw new Error("Injected interruption before index");
          }
          return open(file, "wx", 0o600);
        },
        renameFile: rename,
      },
    }),
  ).rejects.toThrow("did not finish cleanly");
  expect(denied).toBe(1);
  const converted = await readFile(md.file);
  const resumed = await inspectKnowledgeFormat(await f.context());
  expect(resumed).toMatchObject({ required: true, count: 0 });
  await f.apply(resumed.revision);
  expect(await readFile(md.file)).toEqual(converted);
  expect(
    await readFile(
      path.join(plan.recoveryPath, "store/knowledge/requirements/old-page.md"),
      "utf8",
    ),
  ).toBe(md.raw);
  expect(await knowledgeCatalogPrompt(f.service, f.store)).toContain("[[old-page]]");
});

it("accepts a removed imported JSON source but refuses a changed source after its receipt", async () => {
  const f = await fixture();
  const json = await f.writeJson();
  await f.apply((await inspectKnowledgeFormat(await f.context())).revision);
  await writeFile(json.file, json.raw + " ");
  await expect(inspectKnowledgeFormat(await f.context())).rejects.toThrow();
  await rename(json.file, json.file + ".retained");
  expect(await inspectKnowledgeFormat(await f.context())).toMatchObject({ required: false });
});

it("rejects stale source and destination origins before converting", async () => {
  const f = await fixture();
  const md = await f.writeMarkdown();
  const plan = await inspectKnowledgeFormat(await f.context());
  await writeFile(md.file, md.raw + "External editor bytes");
  await expect(f.apply(plan.revision)).rejects.toThrow();
  expect(await readFile(md.file, "utf8")).toBe(md.raw + "External editor bytes");
  const json = await f.writeJson();
  await writeFile(md.file, md.raw);
  const beforeTarget = await inspectKnowledgeFormat(await f.context());
  await writeFile(
    path.join(f.store.base, "knowledge/requirements/json-page.md"),
    createDraftPage({
      kind: "requirement",
      id: "json-page",
      title: "Peer target",
      statement: "Never replace",
      tags: [],
      now: time,
    }),
  );
  await expect(f.apply(beforeTarget.revision)).rejects.toThrow();
  expect(await readFile(json.file, "utf8")).toBe(json.raw);
  expect(await readFile(md.file, "utf8")).toBe(md.raw);
});

it("rejects a changed canonical project origin before any recovery or conversion write", async () => {
  const f = await fixture();
  const md = await f.writeMarkdown();
  const inspected = await inspectKnowledgeFormat(await f.context());
  let reads = 0;
  await expect(
    applyKnowledgeFormat({
      context: async () => ({
        ...(await f.context()),
        projectRevision: reads++ ? "peer-project-change" : "project-revision",
      }),
      expectedRevision: inspected.revision,
      reason: "Human approved fixture",
      now: () => new Date(time),
    }),
  ).rejects.toThrow();
  expect(await readFile(md.file, "utf8")).toBe(md.raw);
  await expect(readdir(path.join(f.store.base, "knowledge-recovery"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects a queued page write after a store switch instead of editing its recovery copy", async () => {
  const f = await fixture();
  const target = { projectId: "project", kind: "requirement", id: "queued-page" } as const;
  const original = await f.service.createDraft({
    ...target,
    title: "Queued",
    statement: "Original bytes",
  });
  let current = f.store;
  let signal = () => {};
  const resolved = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const service = new KnowledgeService({
    resolver: {
      resolve: async () => {
        const captured = current;
        signal();
        return captured;
      },
    },
    now: () => new Date(time),
  });
  let writing: ReturnType<KnowledgeService["updateTruth"]> | undefined;
  await withKnowledgeWrite(f.store, async () => {
    writing = service.updateTruth({
      ...target,
      expectedRevision: original.revision,
      statement: "Do not strand in old storage",
      reason: "Explicit user edit",
    });
    await resolved;
    current = {
      ...f.store,
      location: "host",
      boundary: f.home,
      base: path.join(f.home, "new-active-store"),
    };
  });
  if (!writing) throw new Error("Expected queued write");
  await expect(writing).rejects.toThrow("Knowledge changed");
  expect(digest(await readFile(original.absolutePath))).toBe(original.revision);
  await expect(readdir(current.base)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains partial conversions and recovery bytes, then resumes only after a new explicit plan", async () => {
  const f = await fixture();
  const a = await f.writeMarkdown("old-a");
  const b = await f.writeMarkdown("old-b");
  const json = await f.writeJson();
  const plan = await inspectKnowledgeFormat(await f.context());
  let attempts = 0;
  await expect(
    applyKnowledgeFormat({
      context: f.context,
      expectedRevision: plan.revision,
      reason: "Explicit fixture conversion",
      now: () => new Date(time),
      replacement: {
        openStagedFile: (file) => open(file, "wx", 0o600),
        renameFile: async (from, to) => {
          attempts++;
          if (to === b.file) throw new Error("Injected single denial");
          await rename(from, to);
        },
      },
    }),
  ).rejects.toThrow("did not finish cleanly");
  expect(attempts).toBe(2);
  expect(parseKnowledgePage(await readFile(a.file, "utf8")).metadata.id).toBe("old-a");
  expect(await readFile(b.file, "utf8")).toBe(b.raw);
  expect(
    await readFile(path.join(plan.recoveryPath, "store/knowledge/requirements/old-a.md"), "utf8"),
  ).toBe(a.raw);
  await expect(f.apply(plan.revision)).rejects.toThrow();
  const resumed = await inspectKnowledgeFormat(await f.context());
  expect(resumed.count).toBe(2);
  await f.apply(resumed.revision);
  expect(await inspectKnowledgeFormat(await f.context())).toMatchObject({ required: false });
  expect(await readFile(json.file, "utf8")).toBe(json.raw);
});

it("does not overwrite a conflicting recovery file or resurrect already imported peer edits", async () => {
  const f = await fixture();
  const json = await f.writeJson();
  const plan = await inspectKnowledgeFormat(await f.context());
  const backup = path.join(plan.recoveryPath, "repository/project-knowledge.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "Unrelated recovery bytes");
  await expect(f.apply(plan.revision)).rejects.toThrow();
  expect(await readFile(backup, "utf8")).toBe("Unrelated recovery bytes");
  expect(await readFile(json.file, "utf8")).toBe(json.raw);
  // A new independent fixture exercises the crash point before the receipt.
  const g = await fixture();
  const original = await g.writeJson();
  const conversion = convertLegacyJson(original.raw)[0];
  const target = path.join(g.store.base, "knowledge/requirements/json-page.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, conversion.render({ now: time, reason: "Imported before interruption" }));
  const page = await g.service.read({ projectId: "project", kind: "requirement", id: "json-page" });
  const edited = await g.service.updateTruth({
    projectId: "project",
    kind: "requirement",
    id: "json-page",
    expectedRevision: page.revision,
    statement: "Peer edit after conversion",
    reason: "Explicit change",
  });
  const resumed = await inspectKnowledgeFormat(await g.context());
  expect(resumed).toMatchObject({ required: true, count: 0 });
  await g.apply(resumed.revision);
  expect(digest(await readFile(target))).toBe(edited.revision);
});

it("rejects malformed records, duplicate identities, path escapes and ambiguous evidence without a conversion", () => {
  expect(() =>
    convertLegacyJson(JSON.stringify({ version: 1, records: [record(), record()] })),
  ).toThrow("Duplicate");
  expect(() =>
    convertLegacyJson(JSON.stringify({ version: 1, records: [record("../escape")] })),
  ).toThrow();
  expect(() =>
    convertLegacyMarkdown(
      legacyMarkdown().replace("Retained prior history", "Retained\nmalformed history"),
    ),
  ).toThrow();
  expect(() =>
    convertLegacyMarkdown(
      legacyMarkdown().replace(
        "Original truth",
        "Original truth\n\n## Evidence\n\nAmbiguous section",
      ),
    ),
  ).toThrow("Ambiguous");
});
