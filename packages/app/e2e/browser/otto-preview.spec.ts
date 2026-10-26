import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readPreviewConfig, stopPreviewServer } from "@getpaseo/plugin/otto/preview";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
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
    const scope = { hostId: getServerId(), workspaceId: workspace.workspaceId };
    const port = await freePort();
    const file = path.join(workspace.repoPath, ".claude", "launch.json");
    const script = `require('node:http').createServer((req,res)=>res.end('Preview fixture')).listen(${port},'127.0.0.1',()=>console.log('PREVIEW_READY_PROOF'))`;
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
      await expect(surface.getByText("PREVIEW_READY_PROOF", { exact: false })).toBeVisible();
      await expect(
        surface.getByText("The server is tracked, but its browser could not open.", {
          exact: false,
        }),
      ).toBeVisible();
      // Web acceptance has no native browser host. A failed Open must keep the server and logs.
      await surface.getByRole("button", { name: "Open browser", exact: true }).click();
      await expect(
        surface.getByText("The host could not acknowledge this action.", { exact: false }),
      ).toBeVisible();
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
      await expect(surface.getByText("PREVIEW_READY_PROOF", { exact: false })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`preview-${compact ? "compact" : "wide"}.png`),
      });
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
