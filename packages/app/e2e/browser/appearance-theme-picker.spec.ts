import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";

test("shows Obsidian in the dark appearance picker", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  await page.getByTestId("settings-color-scheme-mode").getByText("Dark", { exact: true }).click();
  const themeTrigger = page.getByLabel(/^Theme:/);
  await themeTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Obsidian", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("appearance-theme-picker.png"),
    fullPage: true,
  });
});

test("keeps the selected workspace visible in Obsidian", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "pure-black-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        "@otto:app-settings",
        JSON.stringify({ colorSchemeMode: "dark", darkTheme: "obsidian" }),
      );
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.mouse.move(0, 0);

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgba(255, 255, 255, 0.09)");
    await page.screenshot({
      path: testInfo.outputPath("pure-black-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("applies the interface font size to settings text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@otto:app-settings",
      JSON.stringify({ uiFontSize: 21, contentFontSize: 21 }),
    );
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sectionTitle = page.getByText("Fonts", { exact: true }).first();
  await expect(sectionTitle).toHaveCSS("font-size", "16px");

  const interfaceSizeInput = page.getByRole("slider", { name: "Interface font size" });
  const contentSizeInput = page.getByRole("slider", { name: "Content size" });
  await expect(interfaceSizeInput).toHaveAttribute("aria-valuenow", "21");
  await expect(contentSizeInput).toHaveAttribute("aria-valuenow", "21");
  await interfaceSizeInput.click({ position: { x: 1, y: 10 } });

  await expect(interfaceSizeInput).toHaveAttribute("aria-valuenow", "12");
  await expect(contentSizeInput).toHaveAttribute("aria-valuenow", "21");
  await expect(sectionTitle).toHaveCSS("font-size", "9px");
});
