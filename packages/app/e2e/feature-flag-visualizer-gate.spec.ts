import { test, expect } from "./fixtures";
import { waitForTabBar } from "./helpers/launcher";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import {
  allVisualizerTabChips,
  openVisualizerFromHeader,
  openVisualizerSettingsSection,
  pressSettingsToggleShortcut,
  readAppSettings,
  visualizerHeaderButton,
  visualizerTabChip,
} from "./helpers/visualizer";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

// docs/feature-flags.md: turning the Visualizer feature off must remove its
// surfaces — the workspace-header button hides (workspace-screen.tsx gates it
// on useFeatureEnabled), any open Visualizer tab is reaped across workspaces
// (use-close-disabled-feature-tabs.ts), and the Settings -> Visualizer section
// collapses to just the master switch (visualizer-section.tsx). Toggling back
// on restores every entry point. The flag itself is the sparse device-local
// `featureEnabled.visualizer` key on @otto:app-settings.

async function expectPersistedVisualizerFlag(
  page: import("@playwright/test").Page,
  expected: boolean,
): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await readAppSettings(page);
      const featureEnabled = settings.featureEnabled as Record<string, boolean> | undefined;
      return featureEnabled?.visualizer ?? null;
    })
    .toBe(expected);
}

test.describe("Feature flag: Visualizer gate", () => {
  test.describe.configure({ timeout: 180_000 });

  test("disabling the Visualizer removes its surfaces; enabling restores them", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "vis-flag-" });

    try {
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      await waitForTabBar(page);

      // Feature defaults on: the header entry point is present and opens a tab.
      await openVisualizerFromHeader(page);

      // Settings -> Visualizer: the master switch is on and the dependent
      // sections (Rendering etc.) are visible while enabled.
      await pressSettingsToggleShortcut(page);
      await expect(page).toHaveURL(/\/settings\//, { timeout: 15_000 });
      await openVisualizerSettingsSection(page);
      await expect(page.getByTestId("settings-visualizer-quality")).toBeVisible();

      // Turn it off. The rest of the section disappears immediately (nothing
      // there applies to a disabled feature); the master switch stays.
      await page.getByTestId("settings-visualizer-enable-switch").click();
      await expectPersistedVisualizerFlag(page, false);
      await expect(page.getByTestId("settings-visualizer-quality")).toHaveCount(0);
      await expect(page.getByTestId("settings-visualizer-enable-switch")).toBeVisible();

      // Back in the workspace: the header button is gone and the previously
      // open Visualizer tab has been reaped by useCloseDisabledFeatureTabs.
      await pressSettingsToggleShortcut(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId), {
        timeout: 15_000,
      });
      await waitForTabBar(page);
      await expect(page.locator('[data-testid="workspace-visualizer-button"]:visible')).toHaveCount(
        0,
        { timeout: 15_000 },
      );
      await expect(allVisualizerTabChips(page)).toHaveCount(0, { timeout: 15_000 });

      // Re-enable from settings.
      await pressSettingsToggleShortcut(page);
      await expect(page).toHaveURL(/\/settings\//, { timeout: 15_000 });
      await openVisualizerSettingsSection(page);
      await page.getByTestId("settings-visualizer-enable-switch").click();
      await expectPersistedVisualizerFlag(page, true);
      await expect(page.getByTestId("settings-visualizer-quality")).toBeVisible({
        timeout: 15_000,
      });

      // The entry point returns and works again.
      await pressSettingsToggleShortcut(page);
      await waitForTabBar(page);
      await expect(visualizerHeaderButton(page)).toBeVisible({ timeout: 15_000 });
      await openVisualizerFromHeader(page);
      await expect(visualizerTabChip(page)).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
