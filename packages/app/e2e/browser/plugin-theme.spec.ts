import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { openSettingsSection } from "../support/helpers/settings";

const PLUGIN_ID = "plugin-theme-e2e";

// Catppuccin Mocha: base, text, surface0, surface1, mauve, subtext0, overlay0.
const PLUGIN_SOURCE = `export default function contribute(plugin) {
  plugin.addTheme({
    id: "mocha",
    name: "Catppuccin Mocha",
    appearance: "dark",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      raised: "#313244",
      control: "#45475a",
      border: "#45475a",
      accent: "#cba6f7",
      mutedForeground: "#a6adc8",
      ring: "#6c7086",
    },
  });
  plugin.addTheme({
    id: "latte",
    name: "Catppuccin Latte",
    appearance: "light",
    colors: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      raised: "#e6e9ef",
      control: "#dce0e8",
      border: "#ccd0da",
      accent: "#8839ef",
      mutedForeground: "#6c6f85",
      ring: "#9ca0b0",
    },
  });
  return () => {};
}`;

// settingsStyles.sectionHeaderTitle paints from foregroundMuted, so the section heading proves the
// contributed palette reached the semantic tokens rather than just the swatch.
const MOCHA_MUTED_FOREGROUND = "rgb(166, 173, 200)";
const LATTE_MUTED_FOREGROUND = "rgb(108, 111, 133)";

test("applies a contributed theme and falls back when its plugin is gone", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@otto:app-settings",
      JSON.stringify({
        colorSchemeMode: "dark",
        darkTheme: "obsidian",
        uiFontSize: 20,
        contentFontSize: 23,
        codeFontSize: 15,
        syntaxTheme: "dracula",
        ...JSON.parse(localStorage.getItem("@otto:app-settings") ?? "{}"),
      }),
    );
  });
  const directory = await mkdtemp(path.join(tmpdir(), "otto-plugin-theme-e2e-"));
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();
  await writeFile(
    path.join(directory, "otto-plugin.json"),
    JSON.stringify({ id: PLUGIN_ID, requirements: pluginRequirements }),
  );
  await writeFile(path.join(directory, "index.client.ts"), PLUGIN_SOURCE);

  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await openSettingsSection(page, "appearance");

    const sectionTitle = page.getByText("Fonts", { exact: true }).first();
    const themeTrigger = page.getByLabel("Plugin theme", { exact: true });
    await themeTrigger.click();
    const mochaItem = page.getByText("Catppuccin Mocha", { exact: true });
    await expect(mochaItem).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-picker.png"),
      animations: "disabled",
      fullPage: true,
    });

    await test.step("a contributed light theme uses the light palette", async () => {
      await page.getByText("Catppuccin Latte", { exact: true }).click();
      await expect(themeTrigger).toContainText("Catppuccin Latte");
      await expect(sectionTitle).toHaveCSS("font-size", "15px");
      await expect(sectionTitle).toHaveCSS("color", LATTE_MUTED_FOREGROUND);
      await themeTrigger.click();
    });

    await mochaItem.click();
    await expect(themeTrigger).toContainText("Catppuccin Mocha");
    await expect(sectionTitle).toHaveCSS("font-size", "15px");
    await expect(sectionTitle).toHaveCSS("color", MOCHA_MUTED_FOREGROUND);
    await page.screenshot({
      path: testInfo.outputPath("plugin-theme-applied.png"),
      fullPage: true,
    });

    await test.step("the selection survives a reload", async () => {
      await page.reload();
      await expect(themeTrigger).toContainText("Catppuccin Mocha", {
        timeout: 30_000,
      });
      await expect(sectionTitle).toHaveCSS("color", MOCHA_MUTED_FOREGROUND);
    });

    await test.step("reloading the palette retains independent typography preferences", async () => {
      await writeFile(
        path.join(directory, "index.client.ts"),
        PLUGIN_SOURCE.replace("#a6adc8", "#b0b0d0"),
      );
      await client.reloadPlugin(PLUGIN_ID);
      await expect(sectionTitle).toHaveCSS("color", "rgb(176, 176, 208)");
      await expect(sectionTitle).toHaveCSS("font-size", "15px");
      await expect(page.getByRole("slider", { name: "Interface font size" })).toHaveAttribute(
        "aria-valuenow",
        "20",
      );
      await expect(page.getByRole("slider", { name: "Content size" })).toHaveAttribute(
        "aria-valuenow",
        "23",
      );
      expect(
        await page.evaluate(() => {
          const { uiFontSize, contentFontSize, codeFontSize, syntaxTheme } = JSON.parse(
            localStorage.getItem("@otto:app-settings") ?? "{}",
          );
          return { uiFontSize, contentFontSize, codeFontSize, syntaxTheme };
        }),
      ).toEqual({ uiFontSize: 20, contentFontSize: 23, codeFontSize: 15, syntaxTheme: "dracula" });
    });

    await test.step("removing the plugin falls back to the default theme", async () => {
      await client.removePlugin(PLUGIN_ID);
      await expect(page.getByLabel("Theme: Obsidian", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(themeTrigger).toHaveCount(0);
      await expect(sectionTitle).toHaveCSS("color", "rgb(166, 166, 166)");
      await expect(sectionTitle).toHaveCSS("font-size", "15px");
      await page.screenshot({
        path: testInfo.outputPath("plugin-theme-fallback.png"),
        fullPage: true,
      });
    });
  } finally {
    await client.removePlugin(PLUGIN_ID).catch(() => undefined);
    await client
      .patchDaemonConfig({ pluginsEnabled: previousConfig.config.pluginsEnabled ?? false })
      .catch(() => undefined);
    await client.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
