import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readContextReport } from "@getpaseo/plugin/otto/context-management";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
const Completion = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.literal("user"), content: z.string() })).length(1),
});
const WorkingSet = z.object({
  rewritableDocuments: z.array(
    z.object({ id: z.string(), label: z.string(), content: z.string() }),
  ),
  readOnlyReferences: z.array(z.object({ id: z.string(), label: z.string(), content: z.string() })),
});
const original =
  "First rule has redundant prose.\n\nKeep separator one.\nKeep separator two.\nKeep separator three.\n\nLast rule has redundant prose.\n[Reference](reference.md)\n";
const proposed = original
  .replace("First rule has redundant prose.", "First rule is concise.")
  .replace("Last rule has redundant prose.", "Last rule is concise.");
const kept = original.replace("First rule has redundant prose.", "First rule is concise.");

for (const compact of [false, true]) {
  test(`Context compaction reviews tool-free proposals, chosen hunks and write recovery (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-context-compaction-",
      title: "Compaction fixture",
      git: false,
    });
    const file = path.join(workspace.repoPath, "AGENTS.md");
    const reference = path.join(workspace.repoPath, "reference.md");
    const lock = `${file}.otto-context-lock`;
    await writeFile(file, original);
    await writeFile(reference, "READ_ONLY_REFERENCE_PROOF\n");
    let rootId = "";
    ottoProvider.replyWith((body) => {
      const input = Completion.parse(body);
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("tool_choice");
      expect(input.model).toBe("fixture");
      const prompt = input.messages[0]!.content;
      const marker = '\n\n{"instruction":';
      const start = prompt.indexOf(marker);
      const end = prompt.indexOf("\n\nYou must respond with JSON only", start);
      const set = WorkingSet.parse(JSON.parse(prompt.slice(start + 2, end)));
      expect(set.rewritableDocuments.map((item) => item.id)).toEqual([rootId]);
      expect(set.readOnlyReferences.map((item) => item.content)).toContain(
        "READ_ONLY_REFERENCE_PROOF\n",
      );
      return JSON.stringify({ files: [{ id: rootId, content: proposed }] });
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "context-compaction-proof" });
    try {
      await ottoProvider.refreshCatalog();
      const report = readContextReport.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readContextReport.name, {
          hostId: getServerId(),
          workspaceId: workspace.workspaceId,
          agentId: null,
          windowTokens: 200000,
        }),
      );
      if (!report.ok) throw Error(report.error.message);
      rootId = report.value.nodes.find((node) => node.label === "AGENTS.md")!.id;
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, workspace.workspaceId);
      await page.getByText("Open Context Management", { exact: true }).click();
      const surface = page.getByTestId("otto-context-management").filter({ visible: true });
      await surface
        .getByTestId(`context-source-${rootId}`)
        .getByRole("button", { name: "Inspect source", exact: true })
        .click();
      await surface.getByRole("button", { name: "Compact with AI", exact: true }).click();
      const review = surface.getByTestId("context-compaction");
      await expect(review.getByText("Rewritable · project", { exact: false })).toBeVisible();
      await review.getByTestId("combined-model-selector").click();
      await page
        .getByTestId("model-search-all-input")
        .or(page.getByTestId("model-search-input"))
        .filter({ visible: true })
        .fill("fixture");
      await page.getByTestId("model-row-openai-compatible-fixture").click();
      await review.getByRole("button", { name: "Generate proposal", exact: true }).click();
      const first = review.getByRole("button", { name: "Keep AGENTS.md change h0", exact: true });
      const last = review.getByRole("button", { name: "Keep AGENTS.md change h1", exact: true });
      await expect(first).toBeVisible();
      await expect(last).toBeVisible();
      expect(await readFile(file, "utf8")).toBe(original);
      expect(ottoProvider.requests).toHaveLength(1);
      await first.click();
      await expect(review.getByTestId(`context-compaction-kept-${rootId}`)).toHaveText(kept);
      expect(await readFile(file, "utf8")).toBe(original);
      const apply = review.getByRole("button", { name: "Apply kept changes", exact: true });
      page.once("dialog", (dialog) => void dialog.dismiss());
      await apply.click();
      expect(await readFile(file, "utf8")).toBe(original);
      await page.screenshot({
        path: testInfo.outputPath(`context-compaction-review-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
      await writeFile(lock, "occupied isolated fixture lock");
      page.once("dialog", (dialog) => void dialog.accept());
      await apply.click();
      await expect(review.getByTestId(`context-compaction-result-${rootId}`)).toContainText(
        "Another context edit is active",
      );
      await expect(apply).toBeDisabled();
      await expect(review.getByTestId(`context-compaction-kept-${rootId}`)).toHaveText(kept);
      expect(await readFile(file, "utf8")).toBe(original);
      await unlink(lock);
      page.once("dialog", (dialog) => void dialog.accept());
      await review.getByRole("button", { name: "Load selected files", exact: true }).click();
      await expect(apply).toBeDisabled();
      await review.getByRole("button", { name: "Generate proposal", exact: true }).click();
      await first.click();
      page.once("dialog", (dialog) => void dialog.accept());
      await apply.click();
      await expect.poll(() => readFile(file, "utf8")).toBe(kept);
      expect(await readFile(reference, "utf8")).toBe("READ_ONLY_REFERENCE_PROOF\n");
      await expect(review.getByTestId(`context-compaction-result-${rootId}`)).toContainText(
        "Kept changes saved",
      );
      await expect(apply).toBeDisabled();
      expect(ottoProvider.requests).toHaveLength(2);
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
