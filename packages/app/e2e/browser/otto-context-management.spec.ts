import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readContextReport } from "@getpaseo/plugin/otto/context-management";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Context Management graph, real source edits and bounded preview (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-context-",
      title: "Context fixture",
      git: false,
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "context-proof" });
    const file = path.join(workspace.repoPath, "AGENTS.md");
    const original = "CONTEXT_ROOT_PROOF\n@rules.md\n[Available](optional.md)\n";
    await writeFile(file, original);
    await writeFile(path.join(workspace.repoPath, "rules.md"), "IMPORTED_CONTEXT_PROOF");
    await writeFile(path.join(workspace.repoPath, "optional.md"), "OPTIONAL_BODY_NOT_FIXED");
    const scope = {
      hostId: getServerId(),
      workspaceId: workspace.workspaceId,
      agentId: null,
      windowTokens: 200000,
    };
    const report = async () => {
      const result = readContextReport.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readContextReport.name, scope),
      );
      if (!result.ok) throw Error(result.error.message);
      return result.value;
    };
    try {
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, workspace.workspaceId);
      await page.getByText("Open Context Management", { exact: true }).click();
      const surface = page.getByTestId("otto-context-management").filter({ visible: true });
      await expect(surface).toBeVisible();
      const before = await report();
      const root = before.nodes.find((node) => node.label === "AGENTS.md")!;
      const rootCard = surface.getByTestId(`context-source-${root.id}`);
      await rootCard.getByRole("button", { name: "Inspect source", exact: true }).click();
      await expect(surface.getByTestId("context-source-preview")).toContainText(
        "CONTEXT_ROOT_PROOF",
      );
      await expect(surface.getByTestId("context-source-preview")).not.toContainText(
        "IMPORTED_CONTEXT_PROOF",
      );
      if (compact)
        await surface.getByRole("button", { name: "Back to context", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await rootCard.getByRole("button", { name: "Change load mode", exact: true }).first().click();
      expect(await readFile(file, "utf8")).toBe(original);
      page.once("dialog", (dialog) => void dialog.accept());
      await rootCard.getByRole("button", { name: "Change load mode", exact: true }).first().click();
      await expect.poll(() => readFile(file, "utf8")).toContain("[rules.md](rules.md)");
      await expect
        .poll(
          async () => (await report()).nodes.find((node) => node.label === "rules.md")?.costClass,
        )
        .toBe("referenced");
      const after = await report();
      expect(after.fixedTokens).toBeLessThan(before.fixedTokens);
      const optional = after.nodes.find((node) => node.label === "optional.md")!;
      await surface
        .getByTestId(`context-source-${optional.id}`)
        .getByRole("button", { name: "Inspect source", exact: true })
        .click();
      await expect(surface.getByTestId("context-source-preview")).toHaveText(
        "OPTIONAL_BODY_NOT_FIXED",
      );
      if (compact)
        await surface.getByRole("button", { name: "Back to context", exact: true }).click();
      await writeFile(file, "EXTERNAL_CONTEXT_CHANGE\n[Available](optional.md)\n");
      await surface.getByRole("button", { name: "Refresh context", exact: true }).click();
      await rootCard.getByRole("button", { name: "Inspect source", exact: true }).click();
      await expect(surface.getByTestId("context-source-preview")).toContainText(
        "EXTERNAL_CONTEXT_CHANGE",
      );
      const box = await surface.getByTestId("context-source-preview").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(16);
      expect(box!.width).toBeGreaterThan(180);
      await page.screenshot({
        path: testInfo.outputPath(`context-management-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
