import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProjectKnowledgeService } from "./project-knowledge-service.js";
import { repositoryKnowledgeStore } from "./project-knowledge-store.js";

function service(root: string): ProjectKnowledgeService {
  return new ProjectKnowledgeService({
    resolveStore: async () => repositoryKnowledgeStore(root),
    logger: { warn: () => undefined } as never,
  });
}

async function temporaryWriteFiles(root: string): Promise<string[]> {
  const directory = path.join(root, ".otto", "knowledge");
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true }))
    if (entry.isFile() && entry.name.endsWith(".tmp")) found.push(entry.name);
  return found;
}

describe("ProjectKnowledgeService", () => {
  it("stores rich Markdown under a human slug and publishes an active-page catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Daemon owns memory",
        statement: "Use **daemon tools** for memory.\n\nSee [[provider-neutral-tools]].",
        status: "confirmed",
      });

      expect(record.id).toBe("daemon-owns-memory");
      const longTitle = await knowledge.record({
        cwd: root,
        kind: "architecture",
        title:
          "Agent providers use shared lifecycle contracts with ACP and direct integration paths",
        statement: "Provider adapters share lifecycle contracts.",
      });
      expect(longTitle.id).toBe(
        "agent-providers-use-shared-lifecycle-contracts-with-acp-and-direct-integration",
      );

      const knowledgeProtocol = await readFile(path.join(root, ".otto", "KNOWLEDGE.md"), "utf8");
      expect(knowledgeProtocol).toContain("default agent behavior is built in");
      expect(knowledgeProtocol).toContain("project-specific supplemental or overriding guidance");
      expect(knowledgeProtocol).not.toContain("capture it immediately");
      const page = await readFile(
        path.join(root, ".otto", "knowledge", "decisions", `${record.id}.md`),
        "utf8",
      );
      expect(page).toContain("<!-- compiled_truth -->");
      expect(page).toContain("Use **daemon tools** for memory.\n\nSee [[provider-neutral-tools]].");
      expect(page).toContain('kind: "decision"');
      expect(await readFile(path.join(root, ".otto", "knowledge", "index.md"), "utf8")).toContain(
        `[[${record.id}]]`,
      );
      expect(await readFile(path.join(root, ".otto", "knowledge", "index.md"), "utf8")).toContain(
        "[Mindmap](mindmap.md)",
      );
      const brief = await knowledge.briefForCwd(root);
      expect(brief.text).toContain("Project knowledge catalog");
      expect(brief.text).toContain("[[daemon-owns-memory]]");
      expect(brief.text).toContain(
        "Default Knowledge policy: write only after an effort is verified",
      );
      expect(brief.text).not.toContain("Project-specific Knowledge guidance exists");
      expect(brief.text).not.toContain("capture it immediately");
      expect(brief.text).toContain("mindmap");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists lightweight catalog records and loads the selected full page directly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const statement = `# Large charter\n\n${"Acceptance criterion. ".repeat(80)}`.trim();
      const created = await knowledge.record({
        cwd: root,
        kind: "project",
        title: "Large charter",
        statement,
        evidence: "Legacy charter source.",
        status: "confirmed",
      });

      const summary = (await knowledge.catalogView(root)).records[0];
      expect(summary.statement.length).toBeLessThanOrEqual(480);
      expect(summary.statement.endsWith("…")).toBe(true);
      expect(summary.statementDigest).toBe(createHash("sha256").update(statement).digest("hex"));
      expect(summary.evidence).toBeUndefined();
      expect(summary.provenance).toBeUndefined();

      const full = await knowledge.get(root, created.id);
      expect(full?.statement).toBe(statement);
      expect(full?.evidence).toBe("Legacy charter source.");
      expect(full?.provenance).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists record pages with the conventional blank line after frontmatter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "requirement",
        title: "Blank frontmatter separator",
        statement: "Normal Markdown spacing must not hide this record.",
        status: "confirmed",
      });
      const pagePath = path.join(root, ".otto", "knowledge", "requirements", `${record.id}.md`);
      const page = await readFile(pagePath, "utf8");
      await writeFile(pagePath, page.replace("\n---\n#", "\n---\n\n#"));

      expect((await knowledge.catalogView(root)).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: record.id })]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses an already-resolved root without re-entering Git root resolution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      let resolves = 0;
      const knowledge = new ProjectKnowledgeService({
        resolveStore: async () => {
          resolves += 1;
          return repositoryKnowledgeStore(root);
        },
        logger: { warn: () => undefined } as never,
      });
      await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Project roots are registered",
        statement: "A workspace supplies its known project root to catalog reads.",
      });
      resolves = 0;

      const view = await knowledge.catalogViewAtStore(repositoryKnowledgeStore(root));

      expect(view.records).toHaveLength(1);
      expect(resolves).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("makes every current-truth change append permanent provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "constraint",
        title: "No automatic rewrites",
        statement: "User review is required for durable truth.",
      });
      const rejected = await knowledge.updateTruth({
        cwd: root,
        id: record.id,
        statement: "Truth changed without a reason.",
        reason: "",
      });
      expect(rejected.error).toContain("requires a reason");
      const changed = await knowledge.updateTruth({
        cwd: root,
        id: record.id,
        statement: "Every durable truth change needs user review.",
        reason: "The team clarified the review boundary.",
        expectedUpdatedAt: record.updatedAt,
      });
      expect(changed.record?.statement).toContain("needs user review");
      expect(changed.record?.provenance?.at(-1)).toMatchObject({
        kind: "decision",
        text: "The team clarified the review boundary.",
      });
      const stale = await knowledge.updateTruth({
        cwd: root,
        id: record.id,
        statement: "Lost edit",
        reason: "Should not apply.",
        expectedUpdatedAt: record.updatedAt,
      });
      expect(stale.error).toContain("changed while it was under review");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses only confirmed pages for normal retrieval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Active storage choice",
        statement: "SQLite stores the active state.",
        status: "confirmed",
      });
      const draft = await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Draft storage choice",
        statement: "SQLite might store future state.",
      });

      expect((await knowledge.query(root, "SQLite storage")).map((record) => record.id)).toEqual([
        "active-storage-choice",
      ]);
      expect(await knowledge.get(root, draft.id)).toBeNull();
      expect((await knowledge.get(root, draft.id, { includeInactive: true }))?.id).toBe(draft.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("separates identical tag sets from partial tag overlap in review findings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Primary record",
        statement: "Primary durable knowledge statement.",
        tags: ["knowledge", "review"],
        status: "confirmed",
      });
      await knowledge.record({
        cwd: root,
        kind: "requirement",
        title: "Same tags",
        statement: "A distinct requirement statement.",
        tags: ["review", "knowledge"],
        status: "confirmed",
      });
      await knowledge.record({
        cwd: root,
        kind: "architecture",
        title: "Some shared tags",
        statement: "A distinct architecture statement.",
        tags: ["knowledge", "architecture"],
        status: "confirmed",
      });

      const tagFindings = (await knowledge.catalogView(root)).findings.filter(
        (finding) => finding.kind === "overlapping_tags",
      );
      expect(tagFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tagOverlap: "complete",
            sharedTags: expect.arrayContaining(["knowledge", "review"]),
          }),
          expect.objectContaining({ tagOverlap: "partial", sharedTags: ["knowledge"] }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("imports every legacy findings report as a normal finding record without deleting the source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const reportPath = path.join(root, "findings", "performance", "2026-08-11-runtime-cost.md");
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        "# Runtime cost investigation\n\n**Date:** 2026-08-11\n\nSee [the method](../../docs/method.md).\n",
      );
      const knowledge = service(root);

      await expect(knowledge.importLegacyFindings(root)).resolves.toEqual({
        imported: 1,
        skipped: 0,
      });
      await expect(knowledge.importLegacyFindings(root)).resolves.toEqual({
        imported: 0,
        skipped: 1,
      });

      const finding = (await knowledge.list(root)).find((record) => record.kind === "finding");
      expect(finding).toMatchObject({
        title: "Runtime cost investigation",
        status: "confirmed",
      });
      expect(finding?.statement).toContain("[the method](../../../docs/method.md)");
      expect(finding?.provenance?.at(-1)).toMatchObject({
        kind: "migration",
        source: "findings/performance/2026-08-11-runtime-cost.md",
      });
      await expect(readFile(reportPath, "utf8")).resolves.toContain("Runtime cost investigation");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates and updates all six rich root pages and lints wiki links", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.bootstrap(root);
      expect((await knowledge.view(root)).rootPages.map((page) => page.slug)).toEqual([
        "background",
        "architecture",
        "flow",
        "mindmap",
        "stack",
        "roadmap",
      ]);

      const updated = await knowledge.updateRoot({
        cwd: root,
        slug: "architecture",
        body: "# Wrong heading\n\nThe daemon owns [[daemon-owns-memory]].\n\n```mermaid\ngraph LR\nA-->B\n```",
      });
      expect(updated?.body).toContain('slug: "architecture"');
      expect(updated?.body).toContain('role: "system architecture"');
      expect(updated?.body).toMatch(/---\n\n# Architecture\n/);
      expect(updated?.body).not.toContain("Wrong heading");
      expect(updated?.body).toContain("```mermaid");
      expect(await knowledge.lintLinks(root)).toEqual([
        { source: "architecture", target: "daemon-owns-memory" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("upgrades an initialized five-root store without replacing customized instructions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      await service(root).bootstrap(root);
      await rm(path.join(root, ".otto", "knowledge", "mindmap.md"));
      const customInstructions =
        "# Project memory policy\n\nOnly record decisions after the architecture review.\n";
      await writeFile(path.join(root, ".otto", "KNOWLEDGE.md"), customInstructions);

      const knowledge = service(root);
      await knowledge.list(root);

      expect(await readFile(path.join(root, ".otto", "knowledge", "mindmap.md"), "utf8")).toContain(
        'slug: "mindmap"',
      );
      expect(await readFile(path.join(root, ".otto", "KNOWLEDGE.md"), "utf8")).toBe(
        customInstructions,
      );
      const brief = (await knowledge.briefForCwd(root)).text;
      expect(brief).toContain("Project-specific Knowledge guidance exists");
      expect(brief).not.toContain("Only record decisions after the architecture review.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps an initialized knowledge store working without KNOWLEDGE.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.bootstrap(root);
      await rm(path.join(root, ".otto", "KNOWLEDGE.md"));

      await knowledge.record({
        cwd: root,
        kind: "requirement",
        title: "Optional project policy",
        statement: "The generated index, not an optional policy file, identifies the store.",
        status: "confirmed",
      });

      await expect(
        readFile(path.join(root, ".otto", "KNOWLEDGE.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect((await knowledge.briefForCwd(root)).text).toContain("[[optional-project-policy]]");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the complete append-only timeline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "constraint",
        title: "Keep the audit trail",
        statement: "Never discard history.",
      });
      for (let index = 0; index < 70; index += 1) {
        await knowledge.appendEvidence({
          cwd: root,
          id: record.id,
          text: `Evidence ${index}`,
        });
      }
      const stored = await knowledge.get(root, record.id, { includeInactive: true });
      expect(stored?.provenance).toHaveLength(71);
      expect(stored?.provenance?.[0].text).toBe("Knowledge page created.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores project delivery separately from review and derives progress from structured data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const project = await knowledge.record({
        cwd: root,
        kind: "project",
        title: "Knowledge management UI",
        statement: "Make durable project knowledge understandable and manageable.",
        status: "confirmed",
        deliveryStatus: "in_build",
        progress: { completed: 3, total: 8, unit: "milestones" },
      });

      expect(project).toMatchObject({
        status: "confirmed",
        deliveryStatus: "in_build",
        progress: { completed: 3, total: 8, unit: "milestones" },
      });
      expect((await knowledge.briefForCwd(root)).text).toContain(
        "[project · in_build · 38%] Knowledge management UI",
      );
      expect(
        await readFile(
          path.join(root, ".otto", "knowledge", "projects", `${project.id}.md`),
          "utf8",
        ),
      ).toContain('delivery_status: "in_build"');

      const updated = await knowledge.updateProject({
        cwd: root,
        id: project.id,
        deliveryStatus: "partial",
        progress: { completed: 5, total: 8, unit: "milestones" },
        reason: "Five reviewed milestones now satisfy their acceptance criteria.",
        expectedUpdatedAt: project.updatedAt,
      });
      expect(updated.record).toMatchObject({
        deliveryStatus: "partial",
        progress: { completed: 5, total: 8, unit: "milestones" },
      });
      expect(updated.record?.provenance?.at(-1)).toMatchObject({
        kind: "note",
        text: "Five reviewed milestones now satisfy their acceptance criteria.",
      });
      expect(
        await knowledge.updateProject({
          cwd: root,
          id: project.id,
          progress: { completed: 9, total: 8, unit: "milestones" },
          reason: "Invalid measurement.",
        }),
      ).toMatchObject({ record: null, error: expect.stringContaining("greater than") });

      const reloaded = await service(root).get(root, project.id, { includeInactive: true });
      expect(reloaded).toMatchObject({
        deliveryStatus: "partial",
        progress: { completed: 5, total: 8, unit: "milestones" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores and reviews references as first-class knowledge", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const reference = await knowledge.record({
        cwd: root,
        kind: "reference",
        title: "Brain.md project knowledge model",
        statement: "The external project informed Otto's page and timeline model.",
        status: "confirmed",
        referenceDisposition: "adopted",
        sourceUrl: "https://example.test/brain-md",
      });
      expect(reference.path).toBeUndefined();
      expect((await knowledge.briefForCwd(root)).text).toContain("[reference · adopted]");

      const updated = await knowledge.updateReference({
        cwd: root,
        id: reference.id,
        disposition: "rejected",
        sourceUrl: null,
        reason: "The source is retained for history but its lifecycle taxonomy was not adopted.",
        expectedUpdatedAt: reference.updatedAt,
      });
      expect(updated.record?.referenceDisposition).toBe("rejected");
      expect(updated.record?.sourceUrl).toBeUndefined();
      expect(updated.record?.provenance?.at(-1)?.kind).toBe("reversal");

      const reloaded = await service(root).get(root, reference.id, { includeInactive: true });
      expect(reloaded).toMatchObject({ referenceDisposition: "rejected" });
      expect(reloaded?.sourceUrl).toBeUndefined();
      expect(reloaded?.path).toContain("knowledge/references/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates the prior JSON foundation into Markdown without losing a record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      await mkdir(path.join(root, ".otto"), { recursive: true });
      await writeFile(
        path.join(root, ".otto", "project-knowledge.json"),
        JSON.stringify({
          version: 1,
          records: [
            {
              id: "legacy-id",
              kind: "decision",
              title: "Legacy decision",
              statement: "Keep durable evidence.",
              tags: ["history"],
              status: "confirmed",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
      const knowledge = service(root);
      await knowledge.bootstrap(root);
      const records = await knowledge.list(root);
      expect(records).toHaveLength(1);
      expect(records[0].provenance?.at(-1)).toMatchObject({ kind: "migration" });
      expect(
        await readFile(path.join(root, ".otto", "knowledge", "decisions", "legacy-id.md"), "utf8"),
      ).toContain("Migrated from .otto/project-knowledge.json");
      expect(
        await readFile(
          path.join(root, ".otto", "knowledge", ".project-knowledge-json-migrated"),
          "utf8",
        ),
      ).toContain("Do not re-import");
      expect(
        await knowledge.delete({
          cwd: root,
          id: "legacy-id",
          reason: "The user identified this imported record as accidental data.",
        }),
      ).toEqual({ deleted: true });
      expect(await service(root).list(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates legacy UUID Markdown to a human slug and rewrites only current wiki links", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.bootstrap(root);
      const legacyId = "c4d4b727-2bc7-45b0-8889-a8d85ef352be";
      const legacyPage = path.join(root, ".otto", "knowledge", "decisions", `${legacyId}.md`);
      await mkdir(path.dirname(legacyPage), { recursive: true });
      await writeFile(
        legacyPage,
        `---\nid: ${legacyId}\nkind: decision\ntitle: Daemon owns project memory\nstatus: confirmed\ntags: architecture, memory\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n# Daemon owns project memory\n\n## Current truth\n\nRead [[${legacyId}]] through daemon tools.\n\n## Evidence\n\nThe original design review.\n\n## Timeline\n\n- 2026-01-01T00:00:00.000Z [created] Created [[${legacyId}]].\n`,
      );
      await writeFile(
        path.join(root, ".otto", "knowledge", "architecture.md"),
        `# Architecture\n\nSee [[${legacyId}]].\n`,
      );

      const records = await service(root).list(root);

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe("daemon-owns-project-memory");
      expect(records[0].statement).toContain("[[daemon-owns-project-memory]]");
      expect(records[0].provenance?.map((entry) => entry.kind)).toEqual([
        "created",
        "evidence",
        "migration",
      ]);
      expect(records[0].provenance?.[0].text).toContain(`[[${legacyId}]]`);
      await expect(readFile(legacyPage, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await readFile(
          path.join(root, ".otto", "knowledge", "decisions", "daemon-owns-project-memory.md"),
          "utf8",
        ),
      ).toContain("<!-- compiled_truth -->");
      expect(
        await readFile(path.join(root, ".otto", "knowledge", "architecture.md"), "utf8"),
      ).toContain("[[daemon-owns-project-memory]]");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes an accidental page only with a reason and stale-write protection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Test",
        statement: "Test",
      });
      const source = await knowledge.record({
        cwd: root,
        kind: "requirement",
        title: "Source",
        statement: `Current truth links [[${record.id}]] and [[${record.id}|with a label]].`,
        evidence: `Historical evidence retains [[${record.id}]].`,
      });
      await knowledge.updateRoot({
        cwd: root,
        slug: "architecture",
        body: `Current map links [[${record.id}#section]].`,
      });

      expect(await knowledge.delete({ cwd: root, id: record.id, reason: "" })).toEqual({
        deleted: false,
        error: "Deleting project knowledge requires a reason.",
      });
      expect(
        await knowledge.delete({
          cwd: root,
          id: record.id,
          reason: "This was accidental fixture data.",
          expectedUpdatedAt: "stale",
        }),
      ).toMatchObject({ deleted: false, error: expect.stringContaining("changed") });
      expect(
        await knowledge.delete({
          cwd: root,
          id: record.id,
          reason: "This was accidental fixture data.",
          expectedUpdatedAt: record.updatedAt,
        }),
      ).toEqual({ deleted: true });
      expect(await knowledge.get(root, record.id, { includeInactive: true })).toBeNull();
      expect(
        (await knowledge.get(root, source.id, { includeInactive: true }))?.statement,
      ).not.toContain(record.id);
      expect((await knowledge.get(root, source.id, { includeInactive: true }))?.evidence).toContain(
        `[[${record.id}]]`,
      );
      expect((await knowledge.getRoot(root, "architecture"))?.body).not.toContain(record.id);
      expect(await knowledge.lintLinks(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("completes a delete when a root page is missing instead of half-scrubbing the store", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Junk",
        statement: "Junk.",
      });
      const source = await knowledge.record({
        cwd: root,
        kind: "requirement",
        title: "Source",
        statement: `See [[${record.id}]] for details.`,
      });
      await knowledge.updateRoot({
        cwd: root,
        slug: "architecture",
        body: `The map links [[${record.id}]].`,
      });
      const missingRootPage = path.join(root, ".otto", "knowledge", "flow.md");
      await rm(missingRootPage);

      expect(
        await knowledge.delete({ cwd: root, id: record.id, reason: "The user called this junk." }),
      ).toEqual({ deleted: true });

      // The scrub reached every page that exists, and the absent root page was
      // skipped rather than resurrected by a delete that never bootstraps.
      const sourcePage = await readFile(
        path.join(root, ".otto", "knowledge", "requirements", `${source.id}.md`),
        "utf8",
      );
      expect(sourcePage).not.toContain(record.id);
      expect(sourcePage).toContain("See for details.");
      expect(
        await readFile(path.join(root, ".otto", "knowledge", "architecture.md"), "utf8"),
      ).not.toContain(record.id);
      expect(
        await readFile(path.join(root, ".otto", "knowledge", "index.md"), "utf8"),
      ).not.toContain(record.id);
      await expect(readFile(missingRootPage, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves no dangling bullet or separator when a deleted page was in a project map", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      const record = await knowledge.record({
        cwd: root,
        kind: "decision",
        title: "Retired",
        statement: "Retired.",
      });
      await knowledge.updateRoot({
        cwd: root,
        slug: "mindmap",
        body: `## Project map\n\n- [[${record.id}]] - the hook\n- [[${record.id}]]\n- A kept row\n`,
      });

      expect(
        await knowledge.delete({ cwd: root, id: record.id, reason: "This page was retired." }),
      ).toEqual({ deleted: true });

      const body = (await knowledge.getRoot(root, "mindmap"))?.body ?? "";
      expect(body).not.toContain(record.id);
      expect(body).toContain("- the hook");
      expect(body).toContain("- A kept row");
      expect(body.split("\n").filter((line) => /^\s*[-*+]\s*$/.test(line))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes its temp file when an atomic write cannot rename onto the target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      // A directory in place of the generated index makes the rename fail the
      // way a held-open destination does on Windows.
      await mkdir(path.join(root, ".otto", "knowledge", "index.md"), { recursive: true });

      await expect(service(root).bootstrap(root)).rejects.toThrow();

      expect(await temporaryWriteFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sweeps stale atomic-write temp files and never reads one as a page", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-project-knowledge-"));
    try {
      const knowledge = service(root);
      await knowledge.record({ cwd: root, kind: "decision", title: "Kept", statement: "Kept." });
      const stale = path.join(
        root,
        ".otto",
        "knowledge",
        "decisions",
        "kept.md.36b739ba-7e72-460a-bbc0-2bce85ed202c.tmp",
      );
      const inFlight = path.join(
        root,
        ".otto",
        "knowledge",
        "index.md.7c1f0a52-4c58-4a4f-9a2c-0a3a2b1c4d5e.tmp",
      );
      const orphan = "---\nid: kept\nkind: decision\ntitle: Kept\n---\n# Kept\n";
      await writeFile(stale, orphan, "utf8");
      await writeFile(inFlight, orphan, "utf8");
      const longAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      await utimes(stale, longAgo, longAgo);

      const records = await service(root).list(root);

      expect(records.map((item) => item.id)).toEqual(["kept"]);
      await expect(readFile(stale, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await temporaryWriteFiles(root)).toEqual([path.basename(inFlight)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
