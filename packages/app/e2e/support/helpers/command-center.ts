import { expect, type Locator, type Page } from "@playwright/test";

// Opens the command center / global search palette from the sidebar and returns its panel.
export async function openCommandCenter(page: Page): Promise<Locator> {
  await page.getByTestId("sidebar-command-center-search").click();
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

export async function closeCommandCenter(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center-panel")).not.toBeVisible();
}

export async function openSettingsFromCommandCenter(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+K`);
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible();
  await panel.getByTestId("command-center-input").fill("settings");
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
}
