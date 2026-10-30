import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  readAtlassianAccount,
  saveAtlassianAccount,
} from "@getpaseo/plugin/otto/atlassian-settings";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readBitbucketConnections } from "@getpaseo/plugin/otto/bitbucket-connections";
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
      // Change shared account metadata through its real RPC. Distinct site
      // values make both layouts actual peer edits, never an idempotent selection.
      const current = readBitbucketConnections.output.parse(
        await client.invokePluginRpc("otto-integrations", readBitbucketConnections.name, {
          hostId,
        }),
      );
      if (!current.ok) throw new Error(current.error.message);
      const account = readAtlassianAccount.output.parse(
        await client.invokePluginRpc("otto-integrations", readAtlassianAccount.name, { hostId }),
      );
      if (!account.ok) throw new Error(account.error.message);
      expect(account.value.credential.stored).toBe(false);
      const peer = saveAtlassianAccount.output.parse(
        await client.invokePluginRpc("otto-integrations", saveAtlassianAccount.name, {
          hostId,
          expectedRevision: account.value.revision,
          config: {
            email: "peer-fixture@example.test",
            siteUrl: compact ? "compact-bitbucket-fixture" : "wide-bitbucket-fixture",
            route: { kind: "site" },
          },
          credential: { kind: "keep" },
        }),
      );
      expect(peer.ok).toBe(true);
      if (!peer.ok) throw new Error(peer.error.message);
      expect(peer.value.revision).not.toBe(account.value.revision);
      expect(peer.value.credential.stored).toBe(false);
      const changed = readBitbucketConnections.output.parse(
        await client.invokePluginRpc("otto-integrations", readBitbucketConnections.name, {
          hostId,
        }),
      );
      if (!changed.ok) throw new Error(changed.error.message);
      expect(changed.value.revision).not.toBe(current.value.revision);
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
