import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { KnowledgeService, type KnowledgeSummary } from "./knowledge-service.js";
import { KnowledgeStoreResolver } from "./store-resolver.js";
import { KnowledgeRecordOperations } from "./record-operations.js";
import { initializeKnowledgeRoots } from "./bootstrap.js";
import { knowledgeCatalogPrompt, KNOWLEDGE_CATALOG_MAX_CHARACTERS } from "./catalog-prompt.js";
import { hasCustomKnowledgePolicy, readKnowledgePolicy } from "./policy.js";
import { appendKnowledgeSessionPrompt } from "./session-prompt.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-catalog/", import.meta.url));
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
  const resolver = new KnowledgeStoreResolver({
    ottoHome: root,
    defaultLocation: () => "repository",
    resolveProject: async (projectId) => ({ projectId, rootPath: root }),
  });
  const service = new KnowledgeService({ resolver, now: () => new Date("2026-10-24T18:00:00Z") });
  const store = await resolver.resolve("canonical-project");
  return { root, service, store };
}
it("does not initialize or mutate an uninitialized project while opening a chat", async () => {
  const f = await fixture();
  expect(await knowledgeCatalogPrompt(f.service, f.store)).toBe("");
  expect(await readdir(f.root)).toEqual([]);
});
it("injects only confirmed metadata and root discovery, never articles, root bodies or history", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "README.md"),
    "Private article body never rides a model request.",
  );
  await initializeKnowledgeRoots({
    service: f.service,
    projectId: f.store.projectId,
    projectRoot: f.root,
  });
  const page = await f.service.createDraft({
    projectId: f.store.projectId,
    kind: "requirement",
    id: "active-page",
    title: "Active metadata",
    statement: "Separate article body",
    tags: [],
  });
  await new KnowledgeRecordOperations(f.service).review({
    projectId: f.store.projectId,
    kind: "requirement",
    id: page.metadata.id,
    expectedRevision: page.revision,
    status: "confirmed",
    reason: "Separate historical review evidence",
  });
  await f.service.createDraft({
    projectId: f.store.projectId,
    kind: "finding",
    id: "draft-page",
    title: "Unreviewed draft",
    statement: "Do not inject draft bodies",
    tags: [],
  });
  const prompt = await knowledgeCatalogPrompt(f.service, f.store);
  expect(prompt).toContain("[[active-page]]");
  expect(prompt).toContain("Active metadata");
  expect(prompt).toContain("background, architecture, flow, mindmap, stack, roadmap");
  for (const absent of [
    "Private article body",
    "Separate article body",
    "Separate historical review evidence",
    "draft-page",
    "Unreviewed draft",
  ])
    expect(prompt).not.toContain(absent);
});
it.each([1, 2, 3])(
  "recognizes frozen 0.9 generated policy %i, including CRLF, without inventing a custom policy",
  async (number) => {
    const raw = (
      await readFile(
        new URL(`fixtures/otto-0.9-generated-policy-${number}.txt`, import.meta.url),
        "utf8",
      )
    ).replace(/\r\n/g, "\n");
    expect(hasCustomKnowledgePolicy(raw)).toBe(false);
    expect(hasCustomKnowledgePolicy(raw.replace(/\n/g, "\r\n"))).toBe(false);
    expect(hasCustomKnowledgePolicy(`${raw}\nCustom project-specific additions.`)).toBe(true);
  },
);
it("recognizes a legacy entry-point-only store and offers custom guidance only as an on-demand pointer", async () => {
  const f = await fixture();
  await mkdir(f.store.base);
  const policy = "Project-specific private guidance that must never be injected automatically.";
  await writeFile(path.join(f.store.base, "KNOWLEDGE.md"), policy);
  const prompt = await knowledgeCatalogPrompt(f.service, f.store);
  expect(prompt).toContain("read_project_knowledge_policy");
  expect(prompt).not.toContain(policy);
  expect(await readKnowledgePolicy(f.store)).toMatchObject({ body: policy, custom: true });
  expect(await readdir(f.store.base)).toEqual(["KNOWLEDGE.md"]);
  expect(hasCustomKnowledgePolicy(" \n")).toBe(false);
});
it("bounds metadata output, quotes multiline titles, and reports the omitted count with discovery instructions", async () => {
  const f = await fixture();
  await f.service.initializeIndex(f.store.projectId);
  const pages: KnowledgeSummary[] = Array.from({ length: 500 }, (_, index) => ({
    id: `page-${index}`,
    kind: "requirement",
    title: `Title ${index}\n${"x".repeat(240)}`,
    status: "confirmed",
    tags: [],
    updatedAt: "2026-10-24",
    revision: "a".repeat(64),
  }));
  let selected: string | undefined;
  const prompt = await knowledgeCatalogPrompt(
    {
      catalog: async (projectId) => {
        selected = projectId;
        return pages;
      },
    },
    f.store,
  );
  const included = prompt.split("\n").filter((line) => line.startsWith("- [[")).length;
  expect(selected).toBe(f.store.projectId);
  expect(prompt.length).toBeLessThanOrEqual(KNOWLEDGE_CATALOG_MAX_CHARACTERS);
  expect(included).toBeGreaterThan(0);
  expect(included).toBeLessThan(200);
  expect(prompt).toContain(`${500 - included} additional active pages`);
  expect(prompt).toContain("list_project_knowledge with search/pagination");
  expect(prompt).not.toContain("\nxxx");
});
it("keeps oversized custom policy reads explicit failures rather than silently truncating them", async () => {
  const f = await fixture();
  await mkdir(f.store.base);
  await writeFile(path.join(f.store.base, "KNOWLEDGE.md"), "x".repeat(524289));
  await expect(readKnowledgePolicy(f.store)).rejects.toThrow("read limit");
});
it("appends runtime-only metadata without mutating the provider config or replacing existing instructions", async () => {
  const config = {
    provider: "codex",
    cwd: "/fixture",
    systemPrompt: "User agent instructions",
    daemonAppendSystemPrompt: "Daemon instructions",
  } as const;
  const calls: string[] = [];
  const launch = await appendKnowledgeSessionPrompt({
    config,
    workspaceId: "workspace-a",
    toolsEnabled: true,
    source: async (id) => {
      calls.push(id);
      return "Current compact catalog";
    },
    unavailable: () => {
      throw new Error("Unexpected failure");
    },
  });
  expect(calls).toEqual(["workspace-a"]);
  expect(launch.systemPrompt).toBe(config.systemPrompt);
  expect(launch.daemonAppendSystemPrompt).toBe("Daemon instructions\n\nCurrent compact catalog");
  expect(config.daemonAppendSystemPrompt).toBe("Daemon instructions");
});
it.each(["internal", "history", "disabled", "disabled-read", "no-workspace"])(
  "skips %s sessions without invoking the Knowledge source",
  async (mode) => {
    const config = { provider: "codex", cwd: "/fixture", internal: mode === "internal" } as const;
    let calls = 0;
    const launch = await appendKnowledgeSessionPrompt({
      config,
      workspaceId: mode === "no-workspace" ? undefined : "workspace",
      purpose: mode === "history" ? "history" : "interactive",
      toolsEnabled: mode !== "disabled",
      disabledTools: mode === "disabled-read" ? ["read_project_knowledge"] : [],
      source: async () => {
        calls++;
        return "Must not be loaded";
      },
      unavailable: () => {},
    });
    expect(launch).toBe(config);
    expect(calls).toBe(0);
  },
);
it("keeps chat startup available with a visible safe catalog error and no fallback store", async () => {
  let reported = 0;
  const launch = await appendKnowledgeSessionPrompt({
    config: { provider: "codex", cwd: "/fixture" },
    workspaceId: "workspace",
    toolsEnabled: true,
    source: async () => {
      throw new Error("private fixture path or token");
    },
    unavailable: () => {
      reported++;
    },
  });
  expect(reported).toBe(1);
  expect(launch.daemonAppendSystemPrompt).toContain("could not read");
  expect(launch.daemonAppendSystemPrompt).not.toContain("private");
});
