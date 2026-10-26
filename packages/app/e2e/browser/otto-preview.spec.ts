import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readPreviewConfig, stopPreviewServer } from "@getpaseo/plugin/otto/preview";
import { z } from "zod";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  connectDaemonClient,
  loadHostBrowserContracts,
} from "../support/helpers/daemon-client-loader";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    socket.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}
for (const compact of [false, true]) {
  test(`Preview configuration, reviewed lifecycle, logs and failed start recovery (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-preview-ui-",
      title: "Preview fixture",
      git: false,
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "preview-acceptance" });
    const { executeHostBrowser } = await loadHostBrowserContracts();
    const scope = { hostId: getServerId(), workspaceId: workspace.workspaceId };
    const port = await freePort();
    const file = path.join(workspace.repoPath, ".claude", "launch.json");
    const html =
      '<!doctype html><title>Preview fixture</title><style>body{font:20px sans-serif;padding:20px}input{font:inherit}</style><h1>Preview fixture</h1><label>Name <input aria-label="Name"></label>';
    const script = `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(html)})}).listen(${port},'127.0.0.1',()=>console.log('PREVIEW_READY_PROOF'))`;
    const launch = (extra: string) =>
      JSON.stringify({
        configurations: [
          {
            name: "web",
            port,
            runtimeExecutable: process.execPath,
            runtimeArgs: ["-e", script + extra],
          },
        ],
      });
    const inspect = async () => {
      const result = readPreviewConfig.output.parse(
        await client.invokePluginRpc("otto-browser", readPreviewConfig.name, scope),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    try {
      await mkdir(path.dirname(file));
      await writeFile(file, launch(""));
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, workspace.workspaceId);
      await page.getByText("Manage Preview servers", { exact: true }).click();
      const surface = page.getByTestId("otto-preview-servers").filter({ visible: true });
      const start = surface.getByRole("button", { name: "Start or reuse", exact: true });
      await expect(start).toBeVisible();
      expect((await inspect()).servers).toEqual([]);
      if (!compact) {
        // The gutter has one play trigger. Management is the final server-menu action,
        // and declining a quick launch has the same no-process guarantee as the page.
        const play = page.getByTestId("workspace-preview-menu").filter({ visible: true });
        await expect(play).toHaveCount(1);
        await play.click();
        const menu = page.getByTestId("workspace-preview-menu-content").filter({ visible: true });
        await expect(menu.getByRole("menuitem").last()).toHaveText("Manage Preview servers");
        page.once("dialog", (dialog) => void dialog.dismiss());
        const quickStart = menu.getByRole("menuitem", { name: "Start or reuse web", exact: true });
        await quickStart.click();
        await expect(quickStart).toBeEnabled();
        expect((await inspect()).servers).toEqual([]);
        await menu.getByRole("menuitem").last().click();
        await expect(menu).not.toBeVisible();
        await expect(surface).toBeVisible();
      }
      page.once("dialog", (dialog) => void dialog.dismiss());
      await start.click();
      await expect(start).toBeEnabled();
      expect((await inspect()).servers).toEqual([]);
      // The exact command changes while the old confirmation is open. No child may start.
      page.once("dialog", async (dialog) => {
        await writeFile(file, launch(";/*changed*/"));
        await dialog.accept();
      });
      await start.click();
      await expect(
        surface.getByText("The host could not acknowledge this action.", { exact: false }),
      ).toBeVisible();
      expect((await inspect()).servers).toEqual([]);
      await surface.getByRole("button", { name: "Refresh servers", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await start.click();
      await expect.poll(async () => (await inspect()).servers[0]?.status).toBe("ready");
      await surface.getByRole("button", { name: "Logs and actions", exact: true }).click();
      await expect(
        surface.getByText("[stdout] PREVIEW_READY_PROOF", { exact: false }),
      ).toBeVisible();
      // Open reveals the daemon's designated page in an ordinary workspace tab.
      await surface.getByRole("button", { name: "Open browser", exact: true }).click();
      const hosted = page.getByTestId("otto-host-browser").filter({ visible: true });
      await expect(
        hosted.getByRole("img", { name: "Host browser page", exact: true }),
      ).toBeVisible();
      await expect(hosted.getByLabel("Browser address", { exact: true })).toHaveValue(
        `http://127.0.0.1:${port}/`,
      );
      const browserId = (await inspect()).servers[0]?.browserId;
      if (!browserId) throw new Error("Preview did not retain its designated browser.");
      const evaluate = async (source: string) => {
        const response = executeHostBrowser.output.parse(
          await client.invokePluginRpc("otto-browser", executeHostBrowser.name, {
            ...scope,
            command: { command: "evaluate", args: { browserId, function: source } },
          }),
        );
        if (!response.ok) throw new Error(response.error.message);
        if (response.result.command !== "evaluate") throw new Error("Expected host evaluation.");
        return JSON.parse(response.result.resultJson);
      };
      const geometry = z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .parse(
          await evaluate(
            "() => { const box=document.querySelector('input').getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2,width:innerWidth,height:innerHeight}; }",
          ),
        );
      const frame = hosted.getByRole("application", { name: "Host browser page", exact: true });
      await expect(frame).toHaveAttribute("data-host-viewport-width", String(geometry.width));
      await expect(frame).toHaveAttribute("data-host-viewport-height", String(geometry.height));
      const box = await frame.boundingBox();
      if (!box) throw new Error("The streamed page has no visible viewport.");
      const scale = Math.min(box.width / geometry.width, box.height / geometry.height);
      await frame.click({
        position: {
          x: (box.width - geometry.width * scale) / 2 + geometry.x * scale,
          y: (box.height - geometry.height * scale) / 2 + geometry.y * scale,
        },
      });
      await page.keyboard.type("Otto");
      await expect
        .poll(() => evaluate("() => document.querySelector('input').value"), { timeout: 10_000 })
        .toBe("Otto");
      await page.screenshot({
        path: testInfo.outputPath(`host-browser-${compact ? "compact" : "wide"}.png`),
      });
      await hosted.getByRole("button", { name: "More", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("menuitem", { name: "Clear browsing history", exact: true }).click();
      await expect(page.getByText("Browsing history cleared", { exact: true })).toBeVisible();
      await page.getByRole("menuitem", { name: "Manage Preview servers", exact: true }).click();
      await expect(surface).toBeVisible();
      expect((await inspect()).servers).toHaveLength(1);
      page.once("dialog", (dialog) => void dialog.accept());
      await surface.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(
        surface.getByText("The owned process tree stopped.", { exact: true }),
      ).toBeVisible();
      await expect(surface.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
      // Corrupt configuration still exposes tracked ownership and output, without rewriting it.
      await writeFile(file, "{malformed");
      await surface.getByRole("button", { name: "Refresh servers", exact: true }).click();
      await expect(
        surface.getByText("Invalid launch configuration", { exact: false }),
      ).toBeVisible();
      await expect(
        surface.getByText("[stdout] PREVIEW_READY_PROOF", { exact: false }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`preview-${compact ? "compact" : "wide"}.png`),
      });
    } catch (error) {
      // Keep the actual panel before fixture cleanup removes its workspace route.
      await page.screenshot({ path: testInfo.outputPath("preview-before-cleanup.png") });
      throw error;
    } finally {
      // Only this fixture's exact host-owned records can be stopped; no PID/port guessing.
      try {
        for (const server of (await inspect()).servers.filter(
          (entry) => entry.managed && entry.status !== "stopped",
        ))
          stopPreviewServer.output.parse(
            await client.invokePluginRpc("otto-browser", stopPreviewServer.name, {
              ...scope,
              serverId: server.id,
              userApprovedStop: true,
            }),
          );
      } finally {
        await client.close();
        await workspace.cleanup();
      }
    }
  });
}
