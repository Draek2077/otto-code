import { test, expect, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { openSettingsSection } from "./helpers/settings";
import { readAppSettings } from "./helpers/visualizer";

// Settings -> Appearance: theme switching applies a token-level style change on
// a known surface (the settings sidebar repaints from theme.colors.surfaceSidebar
// via applyColorScheme), and the "Animations" toggle gates the page-fade veil
// (route-fade-container.web.tsx: transition-duration is PAGE_TRANSITION_DURATION_MS
// after an animated transition and 0ms whenever the setting is off).
//
// All state touched here is device-local localStorage inside this test's own
// browser context — nothing reaches the shared daemon — but each test still
// restores the defaults it changed before finishing.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * First non-transparent computed background inside the settings sidebar — the
 * themed surface under test (sidebarStyles.desktopContainer paints
 * theme.colors.surfaceSidebar, settings-screen.tsx).
 */
async function readSettingsSidebarBackground(page: Page): Promise<Rgb | null> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="settings-sidebar"]');
    if (!root) {
      return null;
    }
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of candidates) {
      const background = getComputedStyle(element as Element).backgroundColor;
      const match = background.match(
        /rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d*(?:\.\d+)?))?\)/,
      );
      if (!match) {
        continue;
      }
      const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (alpha > 0) {
        return {
          r: Number.parseFloat(match[1]),
          g: Number.parseFloat(match[2]),
          b: Number.parseFloat(match[3]),
        };
      }
    }
    return null;
  });
}

function luminance(rgb: Rgb): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

async function expectPersistedColorSchemeMode(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () => (await readAppSettings(page)).colorSchemeMode ?? null)
    .toBe(expected);
}

function modeButton(page: Page, label: "Light" | "Dark" | "System") {
  return page.getByTestId("settings-color-scheme-mode").getByRole("button", {
    name: label,
    exact: true,
  });
}

/** Inline transition-durations (seconds) of every mounted route-fade veil. */
async function readVeilTransitionDurations(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const veils = Array.from(document.querySelectorAll('[data-testid="route-fade-veil"]'));
    return veils.map((veil) => {
      const duration = getComputedStyle(veil).transitionDuration;
      return Number.parseFloat(duration);
    });
  });
}

async function expectPersistedAnimationsEnabled(page: Page, expected: boolean): Promise<void> {
  await expect
    .poll(async () => (await readAppSettings(page)).animationsEnabled ?? null)
    .toBe(expected);
}

async function someVeilAnimated(page: Page): Promise<boolean> {
  const durations = await readVeilTransitionDurations(page);
  return durations.some((duration) => duration > 0);
}

async function allVeilsInstant(page: Page): Promise<boolean> {
  const durations = await readVeilTransitionDurations(page);
  return durations.length > 0 && durations.every((duration) => duration === 0);
}

test.describe("Appearance: theme and animations", () => {
  test.describe.configure({ timeout: 120_000 });

  test("switching between light and dark repaints the themed sidebar surface and persists", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsSection(page, "appearance");

    try {
      // Pin an explicit light scheme first — the default is "system", whose
      // effective spectrum depends on the headless browser's own preference.
      await modeButton(page, "Light").click();
      await expectPersistedColorSchemeMode(page, "light");
      const lightBackground = await readSettingsSidebarBackground(page);
      expect(lightBackground).not.toBeNull();

      await modeButton(page, "Dark").click();
      await expectPersistedColorSchemeMode(page, "dark");
      // The repaint is synchronous with the settings write, but poll anyway so
      // a slow style flush can't race the assertion.
      await expect
        .poll(async () => {
          const current = await readSettingsSidebarBackground(page);
          return current === null ? null : JSON.stringify(current);
        })
        .not.toBe(JSON.stringify(lightBackground));
      const darkBackground = await readSettingsSidebarBackground(page);
      expect(darkBackground).not.toBeNull();

      // Token-level check: the dark variant's sidebar surface is decisively
      // darker than the light variant's (daylight vs dark default palettes).
      expect(luminance(darkBackground as Rgb)).toBeLessThan(luminance(lightBackground as Rgb) - 50);

      // Switching back restores the light palette on the same surface.
      await modeButton(page, "Light").click();
      await expectPersistedColorSchemeMode(page, "light");
      await expect
        .poll(async () => {
          const current = await readSettingsSidebarBackground(page);
          return current === null ? null : JSON.stringify(current);
        })
        .toBe(JSON.stringify(lightBackground));
    } finally {
      // Restore the default mode.
      await modeButton(page, "System").click();
      await expectPersistedColorSchemeMode(page, "system");
    }
  });

  test("the Animations toggle disables the page-fade transition veil", async ({ page }) => {
    await gotoAppShell(page);
    // Entering settings is a route transition, so with animations on (the
    // default) the app-level veil has just run — its inline transition style
    // retains PAGE_TRANSITION_DURATION_MS (300ms) after the reveal completes.
    await openSettings(page);
    await openSettingsSection(page, "appearance");

    const animationsSwitch = page.getByTestId("settings-animations-enabled-switch");
    await expect(animationsSwitch).toBeVisible();

    try {
      // Default on: at least one veil carries the animated transition duration.
      await expect.poll(() => someVeilAnimated(page)).toBe(true);

      // Turn animations off. Every mounted veil is forced to the HIDDEN state
      // (opacity 0, transition-duration 0ms) by the animationsEnabled gate.
      await animationsSwitch.click();
      await expectPersistedAnimationsEnabled(page, false);
      await expect.poll(() => allVeilsInstant(page)).toBe(true);

      // Navigating between pages while disabled must not re-arm the fade: the
      // veils keep a zero transition-duration through the transition.
      await openSettingsSection(page, "general");
      await openSettingsSection(page, "appearance");
      const disabledDurations = await readVeilTransitionDurations(page);
      expect(disabledDurations.length).toBeGreaterThan(0);
      expect(disabledDurations.every((duration) => duration === 0)).toBe(true);

      // Turning it back on must NOT flash a veil over the current screen — the
      // veil is driven by key changes only, so without a navigation everything
      // stays instant/hidden.
      await animationsSwitch.click();
      await expectPersistedAnimationsEnabled(page, true);
      expect(await allVeilsInstant(page)).toBe(true);

      // The next real navigation runs the fade again: at least one veil ends
      // the transition carrying the animated duration.
      await openSettingsSection(page, "general");
      await openSettingsSection(page, "appearance");
      await expect.poll(() => someVeilAnimated(page)).toBe(true);
    } finally {
      // Restore the default (on) if the test failed mid-way.
      const settings = await readAppSettings(page);
      if (settings.animationsEnabled === false) {
        await animationsSwitch.click();
        await expectPersistedAnimationsEnabled(page, true);
      }
    }
  });
});
