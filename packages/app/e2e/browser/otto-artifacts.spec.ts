import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
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
    metadataGeneration: { providers: [{ provider: "openai-compatible", model: "fixture" }] },
  },
});
const html =
  '<!doctype html><html><head><title>Artifact acceptance</title></head><body><h1>Interactive report</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Interact</button><script id="otto-artifact-data" type="application/json">{"value":1}</script><script>try{parent.document.body.dataset.artifactEscape="bad"}catch{document.body.dataset.isolated="yes"}fetch("https://artifact-network.invalid/leak").catch(()=>document.body.dataset.network="blocked")</script></body></html>';
for (const compact of [false, true])
  test(`Artifacts creation, safe preview, data-only update, repair and reopen (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
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
    ottoProvider.replyWith(() => JSON.stringify({ html }));
    await ottoProvider.refreshCatalog();
    const listing = async () => {
      const result = listArtifacts.output.parse(
        await client.invokePluginRpc("otto-artifacts", listArtifacts.name, { scope }),
      );
      if (!result.ok) throw new Error(result.error.message);
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
      const preview = page.frameLocator('iframe[title="Artifact preview"]').last();
      await expect(preview.getByRole("heading", { name: "Interactive report" })).toBeVisible();
      await preview.getByRole("button", { name: "Interact", exact: true }).click();
      await expect(preview.getByRole("heading", { name: "Clicked" })).toBeVisible();
      await expect(preview.locator("body")).toHaveAttribute("data-isolated", "yes");
      await expect(preview.locator("body")).toHaveAttribute("data-network", "blocked");
      expect(await page.locator("body").getAttribute("data-artifact-escape")).toBeNull();
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
      expect(ottoProvider.requests.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
