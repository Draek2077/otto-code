import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoWorkspace } from "../support/helpers/launcher";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readTerminalSettings, saveTerminalSettings } from "@getpaseo/plugin/otto/terminal";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { prepareDroppedPathForTerminal } from "../../src/terminal/drop/terminal-file-drop";
import { getTerminalBufferText } from "../support/helpers/terminal-perf";

async function terminalFontLoaded(page: Page) {
  return page.evaluate(() =>
    Array.from(document.fonts).some(
      (face) => face.family.replace(/^"|"$/g, "") === "OttoNerdSymbols" && face.status === "loaded",
    ),
  );
}

async function clickTerminalDirectory(page: Page) {
  const point = await page.evaluate(() => {
    const terminal = window.__paseoTerminal;
    const surfaces = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-surface"]'),
    );
    const surface = surfaces.find((element) => element.getBoundingClientRect().height > 0);
    const screen = surface?.querySelector(".xterm-screen");
    if (!terminal || !screen) throw new Error("Terminal renderer is unavailable");
    const rect = screen.getBoundingClientRect();
    const buffer = terminal.buffer.active;
    for (let row = buffer.viewportY; row < buffer.viewportY + terminal.rows; row++) {
      const text = buffer.getLine(row)?.translateToString(true) ?? "";
      const col = text.indexOf("config.d");
      if (col >= 0)
        return {
          x: rect.left + ((col + 1.5) * rect.width) / terminal.cols,
          y: rect.top + ((row - buffer.viewportY + 0.5) * rect.height) / terminal.rows,
        };
    }
    throw new Error("Folder link was not visible in the terminal");
  });
  await page.mouse.move(point.x, point.y);
  await expect(
    page.getByTestId("terminal-surface").filter({ visible: true }).locator(".xterm"),
  ).toHaveClass(/xterm-cursor-pointer/);
  await page.mouse.click(point.x, point.y);
}

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
        | "connect"
        | "close"
        | "invokePluginRpc"
        | "createTerminal"
        | "listTerminals"
        | "captureTerminal"
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
      await expect(page.getByRole("alert")).toContainText(
        "Terminal settings changed. Reload before saving.",
      );
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
      const droppedPath = "/tmp/a$(printf WRONG) '& #.txt";
      const quoted = prepareDroppedPathForTerminal(droppedPath, { platform: "linux" });
      const drop = await client.createTerminal(workspace.repoPath, "Literal filename", undefined, {
        workspaceId: workspace.workspaceId,
        command: "/bin/sh",
        args: ["-c", `printf '%s\\n' ${quoted}; sleep 15`],
      });
      if (!drop.terminal) throw new Error(drop.error ?? "No filename probe terminal");
      const dropId = drop.terminal.id;
      await expect
        .poll(async () => (await client.captureTerminal(dropId, { stripAnsi: true })).lines)
        .toContain(droppedPath);
      const directory = path.join(workspace.repoPath, "src/config.d");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "guide.md"), "# Terminal folder destination\n");
      const launched = await client.createTerminal(
        workspace.repoPath,
        "Stable terminal",
        undefined,
        {
          workspaceId: workspace.workspaceId,
          command: process.execPath,
          args: [
            "-e",
            `process.stdout.write("\\x1b]0;/some/project/ignored-title\\x07\\uf120 Terminal symbols \\ue0b0\\r\\n" + ${JSON.stringify(directory)} + "\\r\\n"); setInterval(()=>{},1000)`,
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
      await expect.poll(() => terminalFontLoaded(page)).toBe(true);
      await expect(
        page
          .getByTestId(`workspace-tab-terminal_${launched.terminal.id}`)
          .filter({ visible: true })
          .first(),
      ).toContainText("Stable terminal");
      await page.screenshot({ path: testInfo.outputPath("terminal-symbols.png") });
      await expect.poll(() => getTerminalBufferText(page)).toContain("config.d");
      await clickTerminalDirectory(page);
      await expect(
        page.getByTestId("file-explorer-tree-scroll").getByText("guide.md", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Requested path is not a file", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("terminal-directory.png") });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
