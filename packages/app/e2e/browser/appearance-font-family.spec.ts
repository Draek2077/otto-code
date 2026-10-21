// OTTO(storage): browser fixtures seed the physical Otto storage keys.
import { expect, test } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { openSettingsSection } from "../support/helpers/settings";

async function openAppearance(page: Page) {
  await page.goto("/settings");
  await openSettingsSection(page, "appearance");
}

async function setFontFamily(page: Page, name: string, family: string) {
  const input = page.getByRole("textbox", { name });
  await input.fill(family);
  await input.press("Tab");
}

for (const name of ["Code font family", "Interface font family"]) {
  test(`keeps settings usable after an unfinished quote in ${name}`, async ({ page }, testInfo) => {
    await openAppearance(page);
    await setFontFamily(page, name, "'Fira Code', monospace");
    await expect(page.getByRole("textbox", { name })).toHaveValue("'Fira Code', monospace");

    await setFontFamily(page, name, "'foo");
    await expect(page.getByRole("textbox", { name })).toHaveValue("'Fira Code', monospace");
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "12px");

    await page.screenshot({ path: testInfo.outputPath("rejected-font.png") });
    await page.reload();
    await expect(page.getByRole("textbox", { name })).toHaveValue("'Fira Code', monospace");
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
    await setFontFamily(page, name, "");
    await expect(page.getByRole("textbox", { name })).toHaveValue("");
  });
}

test("opens settings with defaults when a malformed font was already saved", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@otto:app-settings",
      JSON.stringify({ monoFontFamily: "'foo", uiFontFamily: '"foo' }),
    );
  });
  await openAppearance(page);
  await expect(page.getByRole("textbox", { name: "Code font family" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Interface font family" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport();
  await expect(page.getByText("Theme", { exact: true }).first()).toHaveCSS("font-size", "12px");
});

test("upgrades Otto 0.9 settings without losing supported choices or dormant Otto preferences", async ({
  page,
}) => {
  const previous = {
    theme: "dark",
    uiFontFamily: "system-ui",
    monoFontFamily: "monospace",
    uiBaseFontSize: 17,
    contentFontSize: 18,
    codeFontSize: 14,
    sendBehavior: "queue",
    brain: { provider: "local" },
    visualizer: { enabled: false },
    openInSidePane: { explorerChanges: true, chatFiles: true, brain: true },
  };
  await page.addInitScript((settings) => {
    if (!sessionStorage.getItem("otto-upgrade-fixture-seeded")) {
      localStorage.setItem("@otto:app-settings", JSON.stringify(settings));
      sessionStorage.setItem("otto-upgrade-fixture-seeded", "1");
    }
  }, previous);
  await openAppearance(page);
  await expect(page.getByRole("textbox", { name: "Code font family" })).toHaveValue("monospace");
  await expect(page.getByRole("textbox", { name: "Interface font family" })).toHaveValue(
    "system-ui",
  );
  await expect(page.getByLabel("Interface font size")).toHaveValue("17");
  await expect(page.getByLabel("Content font size")).toHaveValue("18");
  await setFontFamily(page, "Code font family", "Consolas, monospace");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("@otto:app-settings") ?? "null")),
    )
    .toMatchObject({
      ...previous,
      monoFontFamily: "Consolas, monospace",
    });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("@otto:pre-0.10/%40otto%3Aapp-settings")))
    .toBe(JSON.stringify(previous));
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Code font family" })).toHaveValue(
    "Consolas, monospace",
  );
  await expect(page.getByLabel("Content font size")).toHaveValue("18");
});
