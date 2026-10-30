import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { createConnectorFixture } from "../support/helpers/otto-connectors";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readConnectors, writeConnectors } from "@getpaseo/plugin/otto/connectors";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Connectors catalog and real MCP connection lifecycle (${compact ? "compact" : "wide"})`, async ({
    page,
    e2eWorker,
  }, testInfo) => {
    void e2eWorker;
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createConnectorFixture();
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "otto-connectors-ui" });
    const hostId = getServerId();
    const read = async () => {
      const result = readConnectors.output.parse(
        await client.invokePluginRpc("otto-integrations", readConnectors.name, { hostId }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    const label = `${compact ? "Compact" : "Wide"} MCP fixture`;
    try {
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
      } else await openSettings(page);
      await page.getByTestId("settings-host-section-plugins").click();
      await page.getByRole("button", { name: "Configure Connectors", exact: true }).click();
      await page.getByRole("button", { name: "Add connector", exact: true }).click();
      await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(30);
      const search = page.getByRole("textbox", { name: "Search connectors", exact: true });
      await search.fill("Google Drive");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "Clear connector search", exact: true }).click();
      await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(30);
      await page.getByRole("button", { name: "Add custom", exact: true }).click();
      await page.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(
        page.getByText(
          "Check the configuration. Arguments must be a JSON list; headers and environment must be JSON objects. No changes were submitted.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByRole("textbox", { name: "Connection name", exact: true }).fill(label);
      await page.getByRole("textbox", { name: "Server URL", exact: true }).fill(fixture.url);
      await page.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(page.getByText("2 tools discovered. verified", { exact: true })).toBeVisible();
      let saved = await read();
      const connection = saved.connectors.find((row) => row.label === label)!;
      expect(connection.enabled).toBe(true);
      expect(connection.verification.toolCount).toBe(2);
      expect(JSON.stringify(saved)).not.toContain("inputSchema");
      await page.getByRole("button", { name: "Tool access (2)", exact: true }).click();
      await page.getByRole("switch", { name: "fixture_write", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await read()).connectors.find((row) => row.id === connection.id)?.disabledTools,
        )
        .toEqual(["fixture_write"]);
      await page.getByRole("button", { name: "Edit connection", exact: true }).click();
      const name = page.getByRole("textbox", { name: "Connection name", exact: true });
      await name.fill(`${label} local draft`);
      saved = await read();
      const peer = writeConnectors.output.parse(
        await client.invokePluginRpc("otto-integrations", writeConnectors.name, {
          hostId,
          expectedRevision: saved.revision,
          action: { kind: "configure", id: connection.id, label: `${label} peer` },
        }),
      );
      expect(peer.ok).toBe(true);
      await page.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(
        page.getByText("Connectors changed. Reload before saving.", { exact: true }),
      ).toBeVisible();
      await expect(name).toHaveValue(`${label} local draft`);
      await expect(
        page.getByRole("button", { name: "Save connection", exact: true }),
      ).toBeDisabled();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
      await expect(name).toHaveValue(`${label} local draft`);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
      await expect(name).toHaveCount(0);
      await page.getByRole("switch", { name: "Enable tools", exact: true }).click();
      await expect
        .poll(
          async () => (await read()).connectors.find((row) => row.id === connection.id)?.enabled,
        )
        .toBe(false);
      expect(fixture.calls()).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("connector-settings.png") });
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expect
        .poll(async () => (await read()).connectors.some((row) => row.id === connection.id))
        .toBe(false);
    } finally {
      try {
        const current = await read();
        for (const connection of current.connectors.filter((row) => row.label.startsWith(label))) {
          const latest = await read();
          await client.invokePluginRpc("otto-integrations", writeConnectors.name, {
            hostId,
            expectedRevision: latest.revision,
            action: { kind: "remove", id: connection.id },
          });
        }
      } finally {
        try {
          await client.close();
        } finally {
          await fixture.close();
        }
      }
    }
  });
}
