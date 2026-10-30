import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  readBitbucketConnections,
  writeBitbucketConnections,
} from "@getpaseo/plugin/otto/bitbucket-connections";
test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Bitbucket settings expose coherent setup and retain stale drafts (${compact ? "compact" : "wide"})`, async ({
    page,
    e2eWorker,
  }, testInfo) => {
    void e2eWorker;
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "otto-bitbucket-ui" });
    const hostId = getServerId();
    try {
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
      } else await openSettings(page);
      await page.getByTestId("settings-host-section-plugins").click();
      await page.getByRole("button", { name: "Configure Bitbucket", exact: true }).click();
      const name = page.getByRole("textbox", { name: "Connection name", exact: true });
      await expect(name).toBeVisible();
      await page.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(
        page.getByText("Enter a connection name, valid Atlassian email, and API token.", {
          exact: true,
        }),
      ).toBeVisible();
      await name.fill("Local work account");
      await page
        .getByRole("textbox", { name: "Atlassian email", exact: true })
        .fill("fixture@example.test");
      const token = page.getByLabel("API token", { exact: true });
      await token.fill("fixture-only-never-stored");
      // Advance metadata through the real RPC. The ensuing stale save is
      // refused before vault access; this journey never installs credentials.
      const current = readBitbucketConnections.output.parse(
        await client.invokePluginRpc("otto-integrations", readBitbucketConnections.name, {
          hostId,
        }),
      );
      if (!current.ok) throw new Error(current.error.message);
      const peer = writeBitbucketConnections.output.parse(
        await client.invokePluginRpc("otto-integrations", writeBitbucketConnections.name, {
          hostId,
          expectedRevision: current.value.revision,
          action: { kind: "select", connectionId: null },
        }),
      );
      expect(peer.ok).toBe(true);
      await page.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(
        page.getByText("Git connections changed. Reload before saving.", { exact: true }),
      ).toBeVisible();
      await expect(name).toHaveValue("Local work account");
      await expect(token).toHaveValue("fixture-only-never-stored");
      await expect(
        page.getByRole("button", { name: "Save connection", exact: true }),
      ).toBeDisabled();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.getByRole("button", { name: "Reload", exact: true }).click();
      await expect(name).toHaveValue("Local work account");
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Reload", exact: true }).click();
      await expect(name).toHaveValue("");
      await expect(token).toHaveValue("");
      await expect(
        page.getByRole("button", { name: "Load workspaces", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "New repository", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("bitbucket-settings.png") });
    } finally {
      await client.close();
    }
  });
}
