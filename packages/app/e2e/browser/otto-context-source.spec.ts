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
  test(`Current Context source drafts, conflicts, saves and issue focus (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-context-source-",
      title: "Current source fixture",
      git: false,
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "context-source-proof" });
    const file = path.join(workspace.repoPath, "AGENTS.md");
    await writeFile(file, "ORIGINAL_CONTEXT_SOURCE\n");
    const report = async () => {
      const result = readContextReport.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readContextReport.name, {
          hostId: getServerId(),
          workspaceId: workspace.workspaceId,
          agentId: null,
          windowTokens: 200000,
        }),
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
      const initial = await report();
      const root = initial.nodes.find((node) => node.label === "AGENTS.md")!;
      await surface
        .getByTestId(`context-source-${root.id}`)
        .getByRole("button", { name: "Inspect source", exact: true })
        .click();
      await expect(surface.getByTestId("context-source-preview")).toHaveText(
        "ORIGINAL_CONTEXT_SOURCE\n",
      );
      const detailTabs = surface.getByTestId("context-detail-tabs");
      await detailTabs.getByText("Current source", { exact: true }).click();
      const input = surface.getByRole("textbox", { name: "Current context source", exact: true });
      await expect(input).toHaveValue("ORIGINAL_CONTEXT_SOURCE\n");
      await input.fill("RETAINED_LOCAL_DRAFT\n");
      await detailTabs.getByText("Prompt preview", { exact: true }).click();
      await detailTabs.getByText("Current source", { exact: true }).click();
      await expect(input).toHaveValue("RETAINED_LOCAL_DRAFT\n");
      page.once("dialog", (dialog) => void dialog.dismiss());
      await surface.getByRole("button", { name: "Reload current source", exact: true }).click();
      await expect(input).toHaveValue("RETAINED_LOCAL_DRAFT\n");
      await writeFile(file, "PEER_CONTEXT_SOURCE\n");
      const save = surface.getByRole("button", { name: "Save source", exact: true });
      page.once("dialog", (dialog) => void dialog.dismiss());
      await save.click();
      expect(await readFile(file, "utf8")).toBe("PEER_CONTEXT_SOURCE\n");
      page.once("dialog", (dialog) => void dialog.accept());
      await save.click();
      await expect(surface.getByTestId("context-write-feedback")).toContainText(
        "The source changed.",
      );
      await expect(input).toHaveValue("RETAINED_LOCAL_DRAFT\n");
      await expect(save).toBeDisabled();
      await surface.getByRole("button", { name: "Refresh context", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await surface.getByRole("button", { name: "Reload current source", exact: true }).click();
      await expect(input).toHaveValue("PEER_CONTEXT_SOURCE\n");
      await input.fill("REVIEWED_CONTEXT_SOURCE\n");
      page.once("dialog", (dialog) => void dialog.accept());
      await save.click();
      await expect.poll(() => readFile(file, "utf8")).toBe("REVIEWED_CONTEXT_SOURCE\n");
      await expect(save).toBeDisabled();
      await surface.getByRole("button", { name: "Refresh context", exact: true }).click();
      if (compact)
        await surface.getByRole("button", { name: "Back to context", exact: true }).click();

      const header = "ISSUE_JUMP_PROOF";
      const missing = "@missing-context.md";
      await writeFile(file, `${header}\n${missing}\n`);
      await surface.getByRole("button", { name: "Refresh context", exact: true }).click();
      const current = await report();
      const issue = current.findingDetails!.find((finding) => finding.kind === "dead_import")!;
      await surface.getByTestId("context-view-tabs").getByText("Issues", { exact: true }).click();
      await surface
        .getByTestId(`context-issue-${issue.id}`)
        .getByRole("button", { name: "Inspect issue", exact: true })
        .click();
      await expect(input).toHaveValue(`${header}\n${missing}\n`);
      await expect(input).toBeFocused();
      await expect
        .poll(() =>
          input.evaluate((node) =>
            node instanceof HTMLTextAreaElement
              ? { start: node.selectionStart, end: node.selectionEnd }
              : null,
          ),
        )
        .toEqual({ start: header.length + 1, end: header.length + 1 + missing.length });
      await page.screenshot({
        path: testInfo.outputPath(`context-current-source-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
