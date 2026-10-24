import { test, expect, openBrainSettings } from "../support/helpers/otto-brain";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

for (const compact of [false, true]) {
  test(`Brain connection conflict preserves the draft until confirmed reload (${compact ? "compact" : "wide"})`, async ({
    page,
    brain,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await openBrainSettings(page, compact);
    const enabled = page.getByRole("switch", { name: "Enable Brain", exact: true });
    const autoStart = page.getByRole("switch", { name: "Start with host", exact: true });
    const save = page.getByRole("button", { name: "Save connection", exact: true });
    // A peer changes the persisted revision after this form captured its draft.
    await autoStart.click();
    await brain.updateConnection({ enabled: true });
    await save.click();
    await expect(
      page.getByText("Brain connection settings changed; reload before saving", { exact: true }),
    ).toBeVisible();
    await expect(autoStart).toBeChecked();
    await expect(enabled).not.toBeChecked();
    await expect(save).toBeDisabled();
    expect((await brain.readConnection()).config).toMatchObject({
      enabled: true,
      autoStart: false,
    });
    await page.screenshot({ path: testInfo.outputPath("brain-settings-conflict.png") });

    const reload = page.getByRole("button", { name: "Reload saved settings", exact: true }).first();
    page.once("dialog", (dialog) => dialog.dismiss());
    await reload.click();
    await expect(autoStart).toBeChecked();
    await expect(enabled).not.toBeChecked();
    page.once("dialog", (dialog) => dialog.accept());
    await reload.click();
    await expect(autoStart).not.toBeChecked();
    await expect(enabled).toBeChecked();
    await autoStart.click();
    await save.click();
    await expect(page.getByText("Connection settings saved", { exact: true })).toBeVisible();
    expect((await brain.readConnection()).config).toMatchObject({ enabled: true, autoStart: true });
    // Saving enabled/autostart intent must not launch a host in this session.
    expect(await brain.localRunning()).toBe(false);
  });
}
