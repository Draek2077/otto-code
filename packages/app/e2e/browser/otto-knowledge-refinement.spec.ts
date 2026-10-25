import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { readKnowledgePage } from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { callKnowledgeMcp, openWorkspaceKnowledge } from "../support/helpers/otto-knowledge";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
async function replacePassage(page: Page, text: string, value: string) {
  const article = page.getByTestId("knowledge-review-article").filter({ visible: true });
  await article.evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = node.textContent?.indexOf(phrase) ?? -1;
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + phrase.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        return;
      }
      node = walker.nextNode();
    }
    throw new Error("The rendered passage was not found");
  }, text);
  await page.getByRole("button", { name: "Replace selection", exact: true }).click();
  await page.getByTestId("knowledge-review-note-value").fill(value);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
}
const original = "First old line.\n\nStable one.\n\nStable two.\n\nStable three.\n\nLast old line.";
function record() {
  return `---\nid: reviewed-page\nkind: requirement\ntitle: Reviewed page\nstatus: confirmed\ntags: []\ncreated_at: "2026-01-01T00:00:00.000Z"\nupdated_at: "2026-01-01T00:00:00.000Z"\nfuture: retained\n---\n# Reviewed page\n\n<!-- compiled_truth -->\n\n${original}\n\n## Timeline\n\n- time: "2026-01-01T00:00:00.000Z"\n  kind: evidence\n  summary: Original evidence\n`;
}
for (const compact of [false, true]) {
  test(`Project Knowledge reviews rendered passages and applies only kept revision-pinned changes (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const project = await seedWorkspace({
      repoPrefix: "otto-knowledge-refine-",
      title: "Knowledge refinement",
      git: false,
    });
    try {
      const directory = path.join(project.repoPath, ".otto/knowledge");
      await mkdir(path.join(directory, "requirements"), { recursive: true });
      const file = path.join(directory, "requirements/reviewed-page.md");
      const raw = record();
      await writeFile(file, raw);
      const rootFile = path.join(directory, "architecture.md");
      await writeFile(rootFile, "# Architecture\n\nOriginal root truth.\n");
      const surface = await openWorkspaceKnowledge({
        page,
        workspaceId: project.workspaceId,
        compact,
      });
      await surface
        .getByTestId("knowledge-record-reviewed-page")
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await surface.getByRole("button", { name: "Review article", exact: true }).click();
      await replacePassage(page, "First old line", "First reviewed line");
      await replacePassage(page, "Last old line", "Last reviewed line");
      expect(await readFile(file, "utf8")).toBe(raw);
      await surface.getByRole("button", { name: "Generate proposal", exact: true }).click();
      await expect(
        surface.getByRole("button", { name: "Drop change h0", exact: true }),
      ).toBeVisible();
      await expect(
        surface.getByRole("button", { name: "Drop change h1", exact: true }),
      ).toBeVisible();
      expect(await readFile(file, "utf8")).toBe(raw);
      await surface.getByRole("button", { name: "Drop change h1", exact: true }).click();
      await surface
        .getByTestId("knowledge-review-reason")
        .fill("Accepted the first reviewed correction only");
      const screenshot = testInfo.outputPath(
        `knowledge-refinement-${compact ? "compact" : "wide"}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("Knowledge kept-change review", {
        path: screenshot,
        contentType: "image/png",
      });
      page.once("dialog", (dialog) => dialog.dismiss());
      await surface.getByRole("button", { name: "Apply kept changes", exact: true }).click();
      expect(await readFile(file, "utf8")).toBe(raw);
      page.once("dialog", (dialog) => dialog.accept());
      await surface.getByRole("button", { name: "Apply kept changes", exact: true }).click();
      await expect(surface.getByTestId("knowledge-review")).toHaveCount(0);
      const saved = readKnowledgePage.output.parse(
        await callKnowledgeMcp("read_project_knowledge", {
          workspaceId: project.workspaceId,
          id: "reviewed-page",
          includeInactive: true,
        }),
      );
      expect(saved).toMatchObject({
        ok: true,
        value: {
          status: "proposed",
          statement: original.replace("First old line", "First reviewed line"),
        },
      });
      const updated = await readFile(file, "utf8");
      expect(updated).toContain("future: retained");
      expect(updated).toContain("Original evidence");
      expect(updated).toContain("Accepted the first reviewed correction only");
      await surface.getByRole("button", { name: "Back to pages", exact: true }).click();
      await surface
        .getByTestId("knowledge-root-architecture")
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await surface.getByRole("button", { name: "Review article", exact: true }).click();
      await replacePassage(page, "Original root truth", "Reviewed root truth");
      await surface.getByRole("button", { name: "Generate proposal", exact: true }).click();
      await surface.getByTestId("knowledge-review-reason").fill("Review root");
      const peer = "# Architecture\n\nNewer peer root truth.\n";
      await writeFile(rootFile, peer);
      await expect(
        surface.getByText(
          "This article changed. Discard this review and reopen the saved article before applying changes.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        surface.getByRole("button", { name: "Apply kept changes", exact: true }),
      ).toBeDisabled();
      expect(await readFile(rootFile, "utf8")).toBe(peer);
      page.once("dialog", (dialog) => dialog.accept());
      await surface.getByRole("button", { name: "Discard review", exact: true }).click();
      await expect(surface.getByText("Newer peer root truth.", { exact: true })).toBeVisible();
    } finally {
      await project.cleanup();
    }
  });
}
