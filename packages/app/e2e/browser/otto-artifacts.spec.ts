import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PersistedConfig } from "../../../server/src/server/persisted-config";
import { listArtifacts, readArtifact } from "@getpaseo/plugin/otto/artifacts";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
test.use({
  e2eDaemonConfig: {
    pluginsEnabled: true,
    agents: {
      metadataGeneration: { providers: [{ provider: "openai-compatible", model: "fixture" }] },
    },
  } satisfies Pick<PersistedConfig, "pluginsEnabled" | "agents">,
});
const artifactTemplate =
  '<!doctype html><html><head><title>Artifact acceptance</title></head><body><h1>Interactive report</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Interact</button><button onclick="location.href=\'ARTIFACT_NAVIGATION_PROBE\'">Navigate outside</button><script id="otto-artifact-data" type="application/json">{"value":1}</script><script>try{parent.document.body.dataset.artifactEscape="bad"}catch{document.body.dataset.isolated="yes"}fetch("https://artifact-network.invalid/leak").catch(()=>document.body.dataset.network="blocked")</script></body></html>';
async function navigationProbe() {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end("Navigation escaped");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing navigation probe address");
  return {
    url: `http://127.0.0.1:${address.port}/navigation-leak`,
    requests: () => requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    },
  };
}
for (const compact of [false, true])
  test(`Artifacts creation, safe preview, data-only update, repair and reopen (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    test.setTimeout(120000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-artifacts-",
      title: "Artifact acceptance",
      git: false,
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "artifacts-proof" });
    const scope = {
      hostId: getServerId(),
      target: { kind: "workspace" as const, id: workspace.workspaceId },
    };
    const probe = await navigationProbe(),
      html = artifactTemplate.replace("ARTIFACT_NAVIGATION_PROBE", probe.url);
    const listing = async () => {
      const result = listArtifacts.output.parse(
        await client.invokePluginRpc("otto-artifacts", listArtifacts.name, { scope }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    try {
      ottoProvider.replyWith(() => JSON.stringify({ html }));
      await ottoProvider.refreshCatalog();
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, workspace.workspaceId);
      await page.getByText("Open Artifacts", { exact: true }).click();
      const surface = page.getByTestId("otto-artifacts-page").filter({ visible: true });
      await expect(surface).toBeVisible();
      await surface.getByRole("button", { name: "New artifact", exact: true }).click();
      await surface.getByRole("button", { name: "Create artifact", exact: true }).click();
      await expect(surface.getByText("Enter a name", { exact: false })).toBeVisible();
      await surface.getByLabel("Artifact name", { exact: true }).fill("Acceptance report");
      await surface
        .getByLabel("Describe the artifact", { exact: true })
        .fill("Build an interactive report with a data contract.");
      await surface.getByRole("button", { name: "Create artifact", exact: true }).click();
      await expect.poll(async () => (await listing()).items[0]?.status).toBe("ready");
      await surface.getByRole("button", { name: "Reload saved output", exact: true }).click();
      const detail = surface.getByTestId("artifact-detail");
      await expect(detail.getByLabel("Artifact data (JSON)")).toHaveValue('{"value":1}');
      const container = page.frameLocator('iframe[title="Artifact preview"]').last();
      const preview = container.frameLocator('iframe[title="Artifact content"]');
      await expect(preview.getByRole("heading", { name: "Interactive report" })).toBeVisible();
      await preview.getByRole("button", { name: "Interact", exact: true }).click();
      await expect(preview.getByRole("heading", { name: "Clicked" })).toBeVisible();
      await expect(preview.locator("body")).toHaveAttribute("data-isolated", "yes");
      await expect(preview.locator("body")).toHaveAttribute("data-network", "blocked");
      expect(await page.locator("body").getAttribute("data-artifact-escape")).toBeNull();
      await preview.getByRole("button", { name: "Navigate outside", exact: true }).click();
      await expect(container.locator("body")).toHaveAttribute("data-navigation-blocked", "yes");
      expect(probe.requests()).toBe(0);
      await detail.getByRole("button", { name: "Reload saved output", exact: true }).click();
      await expect(preview.getByRole("heading", { name: "Interactive report" })).toBeVisible();
      const item = (await listing()).items[0];
      const cli = await promisify(execFile)(
        process.execPath,
        [
          path.resolve(__dirname, "../../../cli/dist/index.js"),
          "artifact",
          "ls",
          "--workspace",
          workspace.workspaceId,
          "--host",
          `ws://127.0.0.1:${getE2EDaemonPort()}/ws`,
          "--json",
        ],
        { timeout: 30000, maxBuffer: 1000000 },
      );
      expect(JSON.parse(cli.stdout).items.map((entry: { id: string }) => entry.id)).toContain(
        item.id,
      );
      const ref = { scope, id: item.id, location: item.location };
      const read = async () => {
        const result = readArtifact.output.parse(
          await client.invokePluginRpc("otto-artifacts", readArtifact.name, ref),
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const original = await read();
      await detail.getByLabel("Artifact data (JSON)").fill("not json");
      await detail.getByRole("button", { name: "Update data only", exact: true }).click();
      await expect(detail.getByText("Enter valid JSON.", { exact: false })).toBeVisible();
      expect(await readFile(original.path, "utf8")).toBe(html);
      await detail.getByLabel("Artifact data (JSON)").fill('{"value":2}');
      await detail.getByRole("button", { name: "Update data only", exact: true }).click();
      await expect.poll(async () => (await read()).data).toContain('"value": 2');
      const updated = await readFile(original.path, "utf8");
      expect(updated.replace(/\{\s*"value": 2\s*\}/, "DATA")).toBe(
        html.replace('{"value":1}', "DATA"),
      );
      await writeFile(original.path, "broken external file");
      await detail.getByRole("button", { name: "Reload saved output", exact: true }).click();
      await expect(detail.getByText("No safe preview is available.")).toBeVisible();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await detail.getByRole("button", { name: "Repair", exact: true }).click();
      expect(await readFile(original.path, "utf8")).toBe("broken external file");
      page.once("dialog", (dialog) => void dialog.accept());
      await detail.getByRole("button", { name: "Repair", exact: true }).click();
      await expect.poll(() => readFile(original.path, "utf8")).toBe(updated);
      await page.reload();
      await expect(surface).toBeVisible();
      await surface.getByRole("button", { name: "Open artifact", exact: true }).click();
      await expect(
        surface.getByTestId("artifact-detail").getByLabel("Artifact data (JSON)"),
      ).toHaveValue(/"value": 2/);
      await page.screenshot({
        path: testInfo.outputPath(`artifacts-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
      const reopened = surface.getByTestId("artifact-detail");
      // A real external writer, not an RPC mock, produces the stale-revision UX.
      await reopened.getByLabel("Artifact name", { exact: true }).fill("My local title");
      const metadataPath = original.path.replace(/\.html$/, ".json");
      const peer = JSON.parse(await readFile(metadataPath, "utf8"));
      await writeFile(metadataPath, JSON.stringify({ ...peer, name: "Peer title" }));
      await reopened.getByRole("button", { name: "Save details", exact: true }).click();
      await expect(
        reopened.getByText("The host could not acknowledge this action.", { exact: false }),
      ).toBeVisible();
      await expect(reopened.getByLabel("Artifact name", { exact: true })).toHaveValue(
        "My local title",
      );
      page.once("dialog", (dialog) => void dialog.accept());
      await reopened.getByRole("button", { name: "Reload saved output", exact: true }).click();
      await expect(reopened.getByLabel("Artifact name", { exact: true })).toHaveValue("Peer title");
      await reopened.getByLabel("Artifact name", { exact: true }).fill("Renamed report");
      await reopened.getByRole("button", { name: "Save details", exact: true }).click();
      await expect.poll(async () => (await read()).artifact.name).toBe("Renamed report");
      await reopened.getByRole("button", { name: "Star", exact: true }).click();
      await expect.poll(async () => (await read()).artifact.starred).toBe(true);
      const downloadPromise = page.waitForEvent("download");
      await reopened.getByRole("button", { name: "Export HTML", exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`otto-artifact-${item.id}.html`);
      const downloaded = await download.path();
      expect(await readFile(downloaded!, "utf8")).toBe((await read()).html);
      page.once("dialog", (dialog) => void dialog.accept());
      await reopened.getByRole("button", { name: "Move to host", exact: true }).click();
      await expect(surface.getByText(/ready · host ·/)).toBeVisible();
      await surface.getByRole("button", { name: "Open artifact", exact: true }).click();
      const moved = surface.getByTestId("artifact-detail");
      const readMoved = async () => {
        const result = readArtifact.output.parse(
          await client.invokePluginRpc("otto-artifacts", readArtifact.name, {
            ...ref,
            location: "host",
          }),
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const movedPath = (await readMoved()).path;
      expect(await readFile(movedPath, "utf8")).toBe(updated);
      await moved.getByLabel("Regeneration instructions").fill("Change the design explicitly");
      page.once("dialog", (dialog) => void dialog.dismiss());
      await moved.getByRole("button", { name: "Regenerate design", exact: true }).click();
      expect(await readFile(movedPath, "utf8")).toBe(updated);
      ottoProvider.replyWith(() =>
        JSON.stringify({ html: html.replace("Interactive report", "New design") }),
      );
      page.once("dialog", (dialog) => void dialog.accept());
      await moved.getByRole("button", { name: "Regenerate design", exact: true }).click();
      await expect.poll(async () => await readFile(movedPath, "utf8")).toContain("New design");
      await expect.poll(async () => (await readMoved()).artifact.status).toBe("ready");
      page.once("dialog", (dialog) => void dialog.accept());
      await moved.getByRole("button", { name: "Reload saved output", exact: true }).click();
      await expect(
        moved.getByRole("button", { name: "Reload saved output", exact: true }),
      ).toBeEnabled();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await moved.getByRole("button", { name: "Delete artifact", exact: true }).click();
      expect((await listing()).items).toHaveLength(1);
      page.once("dialog", (dialog) => void dialog.accept());
      await moved.getByRole("button", { name: "Delete artifact", exact: true }).click();
      await expect.poll(async () => (await listing()).items).toEqual([]);
      await expect(surface.getByText("No artifacts yet", { exact: true })).toBeVisible();
      expect(ottoProvider.requests.length).toBeGreaterThan(0);
    } catch (error) {
      const statePath = testInfo.outputPath("artifact-generation-state.json");
      await writeFile(
        statePath,
        JSON.stringify(
          { library: await listing(), fixtureRequests: ottoProvider.requests },
          null,
          2,
        ),
      );
      await testInfo.attach("artifact-generation-state", {
        path: statePath,
        contentType: "application/json",
      });
      const home = process.env.E2E_PASEO_HOME;
      if (home && path.basename(home).startsWith("paseo-e2e-worker-")) {
        const logPath = testInfo.outputPath("artifact-daemon.log");
        await writeFile(
          logPath,
          (await readFile(path.join(home, "daemon.log"), "utf8")).slice(-128000),
        );
        await testInfo.attach("artifact-daemon-log", {
          path: logPath,
          contentType: "text/plain",
        });
      }
      throw error;
    } finally {
      await probe.close();
      await client.close();
      await workspace.cleanup();
    }
  });
