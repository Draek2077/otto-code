import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readKnowledgePage,
  readKnowledgeReviewSignals,
} from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { callKnowledgeMcp, openWorkspaceKnowledge } from "../support/helpers/otto-knowledge";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
function article(input: {
  id: string;
  tags: string[];
  statement: string;
  status?: "confirmed" | "proposed";
}) {
  const meta = {
    id: input.id,
    kind: "requirement",
    title: input.id === "review-source" ? "Review source" : `Peer ${input.id}`,
    status: input.status ?? "confirmed",
    tags: input.tags,
    created_at: "2000-01-01T00:00:00.000Z",
    updated_at: "2000-01-01T00:00:00.000Z",
  };
  const header = Object.entries(meta)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${header}\n---\n# ${meta.title}\n\n<!-- compiled_truth -->\n\n${input.statement}\n\n## Timeline\n\n- time: "2000-01-01T00:00:00.000Z"\n  kind: evidence\n  summary: Original canonical markdown evidence\n`;
}
for (const compact of [false, true]) {
  test(`Knowledge counted article Review signals stay read-only (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const project = await seedWorkspace({
      repoPrefix: "otto-knowledge-review-",
      title: "Review signals fixture",
      git: false,
    });
    try {
      const directory = path.join(project.repoPath, ".otto/knowledge/requirements");
      await mkdir(directory, { recursive: true });
      const fixtures = [
        {
          id: "review-source",
          tags: ["storage", "atomic"],
          statement: "Canonical markdown evidence is retained.",
        },
        {
          id: "complete-peer",
          tags: ["atomic", "storage"],
          statement: "Retain canonical markdown evidence.",
        },
        { id: "partial-peer", tags: ["storage"], statement: "Canonical markdown only." },
        {
          id: "draft-peer",
          tags: ["storage", "atomic"],
          statement: "Canonical markdown evidence",
          status: "proposed" as const,
        },
      ];
      const original = fixtures.map((item) => ({
        file: path.join(directory, `${item.id}.md`),
        raw: article(item),
      }));
      for (const item of original) await writeFile(item.file, item.raw);
      const source = readKnowledgePage.output.parse(
        await callKnowledgeMcp("read_project_knowledge", {
          workspaceId: project.workspaceId,
          id: "review-source",
        }),
      );
      if (!source.ok) throw new Error(source.error.message);
      const report = readKnowledgeReviewSignals.output.parse(
        await callKnowledgeMcp("read_project_knowledge_review_signals", {
          workspaceId: project.workspaceId,
          kind: "requirement",
          id: "review-source",
          expectedRevision: source.value.revision,
        }),
      );
      expect(report).toMatchObject({
        ok: true,
        value: {
          sourceRevision: source.value.revision,
          eligible: true,
          comparedRecords: 2,
          identicalTagSets: 1,
          partialTagOverlap: 1,
          overlappingTruth: 1,
          stale: true,
        },
      });
      const surface = await openWorkspaceKnowledge({
        page,
        workspaceId: project.workspaceId,
        compact,
      });
      await surface
        .getByTestId("knowledge-record-review-source")
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await surface.getByRole("button", { name: "Review signals", exact: true }).click();
      const signals = surface.getByTestId("knowledge-review-signals");
      await expect(
        signals.getByText("• Identical complete tag sets: 1", { exact: true }),
      ).toBeVisible();
      await expect(signals.getByText("• Partial tag overlap: 1", { exact: true })).toBeVisible();
      await expect(
        signals.getByText("• Overlapping current truth: 1", { exact: true }),
      ).toBeVisible();
      await expect(
        signals.getByText(/^• Stale review: 1 \(last changed \d+ days ago\)$/),
      ).toBeVisible();
      await expect(
        signals.getByText(/Peer complete-peer|Peer partial-peer|Related articles/),
      ).toHaveCount(0);
      await signals.getByRole("button", { name: "Refresh signals", exact: true }).click();
      await expect(
        signals.getByText("• Identical complete tag sets: 1", { exact: true }),
      ).toBeVisible();
      for (const item of original) expect(await readFile(item.file, "utf8")).toBe(item.raw);
      const screenshot = testInfo.outputPath(
        `knowledge-review-${compact ? "compact" : "wide"}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("Counted Review signals", {
        path: screenshot,
        contentType: "image/png",
      });
      await writeFile(
        original[1].file,
        article({
          id: "complete-peer",
          tags: ["different"],
          statement: "Separate isolated assertion.",
        }),
      );
      await expect(
        signals.getByText("• Identical complete tag sets: 1", { exact: true }),
      ).toHaveCount(0);
      await expect(
        signals.getByText("• Overlapping current truth: 1", { exact: true }),
      ).toHaveCount(0);
      await expect(signals.getByText("• Partial tag overlap: 1", { exact: true })).toBeVisible();
      expect(await readFile(original[0].file, "utf8")).toBe(original[0].raw);
      const fresh = readKnowledgeReviewSignals.output.parse(
        await callKnowledgeMcp("read_project_knowledge_review_signals", {
          workspaceId: project.workspaceId,
          kind: "requirement",
          id: "review-source",
          expectedRevision: source.value.revision,
        }),
      );
      expect(fresh).toMatchObject({
        ok: true,
        value: { identicalTagSets: 0, partialTagOverlap: 1, overlappingTruth: 0 },
      });
    } finally {
      await project.cleanup();
    }
  });
}
