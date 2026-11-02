import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoWorkspace } from "../support/helpers/launcher";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readTerminalSettings, saveTerminalSettings } from "@getpaseo/plugin/otto/terminal";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Terminal settings, pinned saves, diagnostics and bundled symbols (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({ repoPrefix: "otto-terminal-", git: false });
    const client = await connectDaemonClient<
      Pick<
        DaemonClient,
        "connect" | "close" | "invokePluginRpc" | "createTerminal" | "listTerminals"
      >
    >({ clientIdPrefix: "terminal-acceptance" });
    const hostId = getServerId();
    const read = async () =>
      readTerminalSettings.output.parse(
        await client.invokePluginRpc("otto-terminal", readTerminalSettings.name, { hostId }),
      );
    try {
      let current = await read();
      await client.invokePluginRpc("otto-terminal", saveTerminalSettings.name, {
        hostId,
        expectedRevision: current.revision,
        patch: { terminalTitleMode: "auto", terminalTitleIncludePaths: false },
      });
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
      } else await openSettings(page);
      await page.getByTestId("settings-host-section-terminals").click();
      const automatic = page.getByRole("switch", { name: "Automatic titles", exact: true });
      await expect(automatic).toBeChecked();
      await automatic.click();
      await page.getByRole("button", { name: "Save preferences", exact: true }).click();
      await expect(page.getByText("Terminal preferences saved", { exact: true })).toBeVisible();
      expect((await read()).preferences.terminalTitleMode).toBe("default");
      await automatic.click();
      current = await read();
      await client.invokePluginRpc("otto-terminal", saveTerminalSettings.name, {
        hostId,
        expectedRevision: current.revision,
        patch: { terminalTitleIncludePaths: true },
      });
      await page.getByRole("button", { name: "Save preferences", exact: true }).click();
      await expect(
        page.getByText("Terminal settings changed. Reload before saving.", { exact: true }),
      ).toBeVisible();
      await expect(automatic).toBeChecked();
      await expect(
        page.getByRole("button", { name: "Save preferences", exact: true }),
      ).toBeDisabled();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.getByRole("button", { name: "Reload settings", exact: true }).click();
      await expect(automatic).toBeChecked();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Reload settings", exact: true }).click();
      await expect(automatic).not.toBeChecked();
      await page.getByRole("button", { name: "Test compatibility", exact: true }).click();
      await expect(page.getByTestId("terminal-check-resize")).toContainText("PASS", {
        timeout: 30000,
      });
      await expect(page.getByTestId("terminal-check-alternate-screen")).toContainText("PASS");
      await page.screenshot({ path: testInfo.outputPath("terminal-settings.png") });
      const launched = await client.createTerminal(
        workspace.repoPath,
        "Stable terminal",
        undefined,
        {
          workspaceId: workspace.workspaceId,
          command: process.execPath,
          args: [
            "-e",
            'process.stdout.write("\\x1b]0;/some/project/ignored-title\\x07\\uf120 Terminal symbols \\ue0b0\\r\\n"); setInterval(()=>{},1000)',
          ],
        },
      );
      if (!launched.terminal) throw new Error(launched.error ?? "No terminal was created");
      await gotoWorkspace(page, workspace.workspaceId);
      await page
        .getByTestId(`workspace-tab-terminal_${launched.terminal.id}`)
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page.getByTestId("terminal-surface").filter({ visible: true }).first(),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.fonts.check("13px OttoNerdSymbols", "\uf120")))
        .toBe(true);
      await expect(
        page
          .getByTestId(`workspace-tab-terminal_${launched.terminal.id}`)
          .filter({ visible: true })
          .first(),
      ).toContainText("Stable terminal");
      await page.screenshot({ path: testInfo.outputPath("terminal-symbols.png") });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
