import { expect, test, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { connectDaemonClient } from "./helpers/daemon-client-loader";
import { getServerId } from "./helpers/server-id";
import {
  expectProviderInstalledInSettings,
  installAcpCatalogProvider,
  openAddProviderArea,
  openSettingsHost,
  openSettingsHostSection,
} from "./helpers/settings";

const CUSTOM_PROVIDER = {
  id: "junie",
  name: "Junie",
} as const;

interface ProviderRemovalDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  patchDaemonConfig(config: { removeProviders?: string[] }): Promise<unknown>;
  getProvidersSnapshot(): Promise<{
    entries: Array<{ provider: string; source?: "builtin" | "custom" }>;
  }>;
}

async function removeCustomProvider(client: ProviderRemovalDaemonClient): Promise<void> {
  await client.patchDaemonConfig({ removeProviders: [CUSTOM_PROVIDER.id] });
}

async function expectProviderSource(
  client: ProviderRemovalDaemonClient,
  source: "custom" | undefined,
): Promise<void> {
  await expect
    .poll(async () => {
      const snapshot = await client.getProvidersSnapshot();
      return snapshot.entries.find((entry) => entry.provider === CUSTOM_PROVIDER.id)?.source;
    })
    .toBe(source);
}

async function clickRemoveProviderAndAcceptWarning(page: Page): Promise<void> {
  await page.getByTestId(`provider-remove-${CUSTOM_PROVIDER.id}`).click();
  const confirmation = page.getByTestId("confirm-dialog");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(`Remove ${CUSTOM_PROVIDER.name}?`);
  await expect(confirmation).toContainText(
    "This deletes the provider and its configuration from this host.",
  );
  await confirmation.getByTestId("confirm-dialog-confirm").click();
  await expect(confirmation).not.toBeVisible();
}

test.describe("provider removal", () => {
  test("removes a custom provider from Settings", async ({ page }) => {
    test.setTimeout(120_000);
    const client = await connectDaemonClient<ProviderRemovalDaemonClient>({
      clientIdPrefix: "provider-removal-e2e",
    });

    try {
      await removeCustomProvider(client);

      await gotoAppShell(page);
      await openSettings(page);
      await openSettingsHost(page, getServerId());
      await openSettingsHostSection(page, getServerId(), "providers");

      await expect(page.getByTestId("provider-actions-claude")).toHaveCount(0);
      await openAddProviderArea(page);
      await installAcpCatalogProvider(page, CUSTOM_PROVIDER.name);
      await expectProviderInstalledInSettings(page, CUSTOM_PROVIDER.name);
      await expectProviderSource(client, "custom");

      await page.getByTestId(`provider-actions-${CUSTOM_PROVIDER.id}`).click();
      await expect(page.getByTestId(`provider-remove-${CUSTOM_PROVIDER.id}`)).toBeVisible();
      await clickRemoveProviderAndAcceptWarning(page);

      await expect(
        page.getByRole("button", {
          name: `${CUSTOM_PROVIDER.name} provider details`,
          exact: true,
        }),
      ).toHaveCount(0);
      await expectProviderSource(client, undefined);
    } finally {
      await removeCustomProvider(client).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
