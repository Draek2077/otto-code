import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { KnowledgeService } from "./knowledge-service.js";
import { KnowledgeStoreResolver } from "./store-resolver.js";
import { KnowledgeRecordOperations, recordDetails } from "./record-operations.js";
import { initializeKnowledgeRoots } from "./bootstrap.js";

const scratch = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-record-operations/", import.meta.url),
);
const fixtures: string[] = [];
afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    if (!root.startsWith(scratch)) throw new Error("Fixture escaped scratch");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "case-"));
  fixtures.push(root);
  const service = new KnowledgeService({
    resolver: new KnowledgeStoreResolver({
      ottoHome: root,
      defaultLocation: () => "repository",
      resolveProject: async (projectId) => ({ projectId, rootPath: root }),
    }),
    now: () => new Date("2026-10-24T17:00:00Z"),
  });
  const records = new KnowledgeRecordOperations(service);
  const target = { projectId: "project-a", kind: "project", id: "charter" } as const;
  const page = await service.createDraft({
    ...target,
    title: "Charter",
    statement: "Full feature",
    tags: ["delivery"],
  });
  return { root, service, records, target, page };
}

it("keeps charter review separate from structured delivery and preserves unknown metadata/history", async () => {
  const { root, service, records, target, page } = await fixture();
  const file = path.join(root, ".otto/knowledge/projects/charter.md");
  const original = (await readFile(file, "utf8")).replace(
    "status:",
    "retained_unknown: {nested: true}\nstatus:",
  );
  await writeFile(file, original);
  const current = await service.read(target);
  const reviewed = await records.review({
    ...target,
    expectedRevision: current.revision,
    status: "confirmed",
    reason: "Philippe approved this charter.",
  });
  const saved = await records.delivery({
    ...target,
    expectedRevision: reviewed.revision,
    deliveryStatus: "in_build",
    progress: { completed: 1, total: 4, unit: "slices" },
    reason: "First slice verified.",
  });
  expect(saved.metadata.status).toBe("confirmed");
  expect(saved.metadata.retained_unknown).toEqual({ nested: true });
  expect(recordDetails(saved)).toMatchObject({
    deliveryStatus: "in_build",
    progress: { percentage: 25 },
  });
  expect(saved.timeline).toContain("Philippe approved");
  expect(saved.timeline).toContain("First slice verified");
  await expect(
    records.delivery({
      ...target,
      expectedRevision: page.revision,
      deliveryStatus: "complete",
      reason: "stale",
    }),
  ).rejects.toThrow("changed");
  expect((await service.read(target)).revision).toBe(saved.revision);
});

it("rejects invalid progress, wrong record kinds and empty reasons without writes", async () => {
  const { service, records, target, page } = await fixture();
  expect(() =>
    records.delivery({
      ...target,
      expectedRevision: page.revision,
      deliveryStatus: "complete",
      progress: { completed: 5, total: 4, unit: "slices" },
      reason: "bad",
    }),
  ).toThrow();
  expect(() =>
    records.delivery({
      ...target,
      kind: "finding",
      expectedRevision: page.revision,
      deliveryStatus: "complete",
      reason: "bad",
    }),
  ).toThrow("charter");
  expect(() =>
    records.review({
      ...target,
      expectedRevision: page.revision,
      status: "confirmed",
      reason: " ",
    }),
  ).toThrow();
  expect((await service.read(target)).revision).toBe(page.revision);
});

it("demotes edited confirmed truth and retains every earlier review event", async () => {
  const { service, records, target, page } = await fixture();
  const reviewed = await records.review({
    ...target,
    expectedRevision: page.revision,
    status: "confirmed",
    reason: "Explicit human review",
  });
  const saved = await service.updateTruth({
    ...target,
    expectedRevision: reviewed.revision,
    statement: "Changed conclusion",
    reason: "New evidence",
  });
  expect(saved.metadata.status).toBe("proposed");
  expect(saved.timeline).toContain("Explicit human review");
  expect(saved.timeline).toContain("New evidence");
});

it("updates title, tags and rendered heading together", async () => {
  const { service, records, target, page } = await fixture();
  const saved = await records.describe({
    ...target,
    expectedRevision: page.revision,
    title: "Renamed charter",
    tags: ["restoration"],
    reason: "Clarify name",
  });
  expect(saved.metadata.title).toBe("Renamed charter");
  expect(saved.metadata.tags).toEqual(["restoration"]);
  expect(await readFile(saved.absolutePath, "utf8")).toContain("# Renamed charter\n");
  expect(await service.catalog("project-a", true)).toEqual([
    expect.objectContaining({ title: "Renamed charter" }),
  ]);
});

it("updates reference evaluation with explicit source and rejects unsafe URLs", async () => {
  const { service, records } = await fixture();
  const target = { projectId: "project-a", kind: "reference", id: "primary-source" } as const;
  const page = await service.createDraft({
    ...target,
    title: "Primary source",
    statement: "Evaluated dependency",
  });
  expect(() =>
    records.reference({
      ...target,
      expectedRevision: page.revision,
      disposition: "adopted",
      sourceUrl: "javascript:alert(1)",
      reason: "unsafe",
    }),
  ).toThrow();
  const saved = await records.reference({
    ...target,
    expectedRevision: page.revision,
    disposition: "adopted",
    sourceUrl: "https://example.test/docs",
    reason: "Verified official API",
  });
  expect(recordDetails(saved)).toMatchObject({
    referenceDisposition: "adopted",
    sourceUrl: "https://example.test/docs",
  });
  expect(saved.metadata.status).toBe("proposed");
});

it.each([
  { mode: "oversized", expected: "exceeds the 256 KiB source limit" },
  { mode: "directory", expected: "symbolic link or non-regular file" },
  { mode: "absent", expected: "absent at inspection" },
])(
  "discloses $mode README source gaps without inventing repository purpose or silently claiming absence",
  async ({ mode, expected }) => {
    const { root, service } = await fixture();
    if (mode === "oversized") await writeFile(path.join(root, "README.md"), "x".repeat(262145));
    if (mode === "directory") await mkdir(path.join(root, "README.md"));
    const result = await initializeKnowledgeRoots({
      service,
      projectId: "project-a",
      projectRoot: root,
    });
    expect(result.created).toHaveLength(6);
    for (const slug of [
      "background",
      "architecture",
      "flow",
      "mindmap",
      "stack",
      "roadmap",
    ] as const) {
      const body = (await service.readRoot({ projectId: "project-a", slug }))?.body;
      expect(body).toContain(
        `\`README.md\`: ${mode === "absent" ? "" : "not inspected: "}${expected}.`,
      );
      expect(body).toContain("`package.json`: absent at inspection.");
      expect(body).toContain("`docs/README.md`: absent at inspection.");
      expect(body).not.toContain("No README is present");
    }
    expect((await service.readRoot({ projectId: "project-a", slug: "stack" }))?.body).toContain(
      "Package behavior is unknown",
    );
    expect((await service.readRoot({ projectId: "project-a", slug: "flow" }))?.body).not.toContain(
      "No package commands are declared",
    );
  },
);

it.each(["{broken", "[]"])(
  "keeps invalid or non-object manifest evidence explicit (%s)",
  async (manifest) => {
    const { root, service } = await fixture();
    await writeFile(path.join(root, "README.md"), "");
    await writeFile(path.join(root, "package.json"), manifest);
    await initializeKnowledgeRoots({ service, projectId: "project-a", projectRoot: root });
    expect(
      (await service.readRoot({ projectId: "project-a", slug: "background" }))?.body,
    ).toContain("The inspected README is empty");
    const body = (await service.readRoot({ projectId: "project-a", slug: "stack" }))?.body;
    expect(body).toContain(manifest === "[]" ? "not a JSON object" : "could not be parsed");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(manifest);
  },
);

it("bootstraps six source-backed roots explicitly and never overwrites authored or empty roots", async () => {
  const { root, service } = await fixture();
  await writeFile(path.join(root, "README.md"), "# Original project\n\nRepository purpose.\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { dev: "node server.js" },
      dependencies: { example: "1.0.0" },
    }),
  );
  await service.writeRoot({
    projectId: "project-a",
    slug: "background",
    expectedRevision: null,
    body: "",
  });
  const initialized = await initializeKnowledgeRoots({
    service,
    projectId: "project-a",
    projectRoot: root,
  });
  expect(initialized.created).toHaveLength(5);
  const index = path.join(root, ".otto/knowledge/index.md");
  expect(await readFile(index, "utf8")).toContain("Generated by Otto");
  await writeFile(index, "User-authored index notes remain unchanged.\n");
  expect((await service.readRoot({ projectId: "project-a", slug: "background" }))?.body).toBe("");
  expect((await service.readRoot({ projectId: "project-a", slug: "stack" }))?.body).toContain(
    '"example":"1.0.0"',
  );
  expect(
    (await initializeKnowledgeRoots({ service, projectId: "project-a", projectRoot: root }))
      .created,
  ).toEqual([]);
  expect(await readFile(index, "utf8")).toBe("User-authored index notes remain unchanged.\n");
  await expect(
    service.writeRoot({
      projectId: "project-a",
      slug: "stack",
      expectedRevision: null,
      body: "overwrite",
    }),
  ).rejects.toThrow("changed");
});
