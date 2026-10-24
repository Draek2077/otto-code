import { test, expect, openBrainSettings } from "../support/helpers/otto-brain";
import { gotoAppShell } from "../support/helpers/app";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

for (const compact of [false, true]) {
  test(`Brain settings, icon and five operational tabs are reachable without launching a runtime (${compact ? "compact" : "wide"})`, async ({
    page,
    brain,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await openBrainSettings(page, compact);
    const enable = page.getByRole("switch", { name: "Enable Brain", exact: true });
    const autoStart = page.getByRole("switch", { name: "Start with host", exact: true });
    await expect(enable).not.toBeChecked();
    await expect(autoStart).not.toBeChecked();
    expect(await brain.localRunning()).toBe(false);
    await enable.click();
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByText("Connection settings saved", { exact: true })).toBeVisible();
    await expect(autoStart).not.toBeChecked();
    await page.reload();
    await expect(enable).toBeChecked();
    expect(await brain.localRunning()).toBe(false);
    await page.getByRole("button", { name: "Open Brain", exact: true }).click();
    await expect(page.getByTestId("brain-overview-start")).toBeEnabled();
    for (const tab of ["Overview", "Library", "Models", "Benchmark", "Logs"]) {
      const control = page.getByRole("button", { name: tab, exact: true });
      await expect(control).toBeVisible();
      await control.click();
      await expect(control).toHaveAttribute("aria-selected", "true");
    }
    // Start the sidebar journey from its actual app-shell owner. Compact plugin
    // screens deliberately use Paseo's Back header, not a second menu button.
    await gotoAppShell(page);
    if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    const icon = page.locator('[data-testid="otto-brain-sidebar"]:visible').first();
    await expect(icon).toBeVisible();
    await expect(page.getByTestId("sidebar-footer").getByTestId("otto-brain-sidebar")).toHaveCount(
      0,
    );
    await expect(icon).toHaveText("");
    const state = await icon.getAttribute("aria-label");
    expect(state).toMatch(/^Brain/);
    if (!compact) {
      await icon.hover();
      await expect(page.getByTestId("otto-brain-state-tooltip")).toHaveText(state!);
      await page.screenshot({ path: testInfo.outputPath("brain-navigation-tooltip.png") });
    }
    await icon.click();
    await expect(page.getByRole("button", { name: "Logs", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("brain-reachable.png") });
    if (compact) {
      await expect(page.getByRole("button", { name: "Close menu", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Open menu", exact: true }).first(),
      ).toBeVisible();
    }
    expect(await brain.localRunning()).toBe(false);
  });
}
