import { test, expect, type Page } from "../support/fixtures";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  readAtlassianAccount,
  saveAtlassianAccount,
} from "@getpaseo/plugin/otto/atlassian-settings";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
async function openAccount(page: Page, compact: boolean) {
  await gotoAppShell(page);
  if (compact) {
    await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
  } else await openSettings(page);
  await page.getByTestId("settings-host-section-plugins").click();
  await page.getByRole("button", { name: "Configure Atlassian", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Account email", exact: true })).toBeVisible();
}
for (const compact of [false, true]) {
  test(`shared Atlassian settings preserve conflicts without accessing native credentials (${compact ? "compact" : "wide"})`, async ({
    page,
    e2eWorker,
  }, testInfo) => {
    void e2eWorker;
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "otto-integrations-ui" });
    const hostId = getServerId();
    const read = async () => {
      const result = readAtlassianAccount.output.parse(
        await client.invokePluginRpc("otto-integrations", readAtlassianAccount.name, { hostId }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    try {
      // This fixture never supplies an API key or requests a native vault write.
      expect((await read()).credential.stored).toBe(false);
      await openAccount(page, compact);
      if (!compact) await expect(page.getByTestId("page-title")).toHaveText("Atlassian account");
      await page
        .getByRole("textbox", { name: "Account email", exact: true })
        .fill("fixture@example.test");
      const site = page.getByRole("textbox", { name: "Jira site", exact: true });
      await site.fill(compact ? "compact-fixture" : "wide-fixture");
      await page.getByRole("button", { name: "Save account", exact: true }).click();
      await expect(page.getByText("Atlassian account saved", { exact: true })).toBeVisible();
      const saved = await read();
      expect(saved.config?.siteUrl).toBe(
        `https://${compact ? "compact-fixture" : "wide-fixture"}.atlassian.net`,
      );
      expect(saved.credential.stored).toBe(false);
      await site.fill("local-draft");
      if (!saved.config) throw new Error("Expected saved fixture configuration");
      const peer = saveAtlassianAccount.output.parse(
        await client.invokePluginRpc("otto-integrations", saveAtlassianAccount.name, {
          hostId,
          expectedRevision: saved.revision,
          config: { ...saved.config, siteUrl: "peer-fixture" },
          credential: { kind: "keep" },
        }),
      );
      expect(peer.ok).toBe(true);
      await page.getByRole("button", { name: "Save account", exact: true }).click();
      await expect(
        page.getByText("Shared integration settings changed. Reload before saving.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(site).toHaveValue("local-draft");
      await expect(page.getByRole("button", { name: "Save account", exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath("atlassian-settings-conflict.png") });
      await page.getByRole("button", { name: "Reload saved account", exact: true }).click();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(site).toHaveValue("local-draft");
      await page.getByRole("button", { name: "Reload saved account", exact: true }).click();
      await page.getByRole("button", { name: "Discard and reload account", exact: true }).click();
      await expect(site).toHaveValue("https://peer-fixture.atlassian.net");
    } finally {
      await client.close();
    }
  });
}
