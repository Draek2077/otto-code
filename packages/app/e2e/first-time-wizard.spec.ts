import { expect, test, type Page } from "./fixtures";

// First-run setup wizard (packages/app/src/screens/setup-wizard/). The trigger
// is purely device-local: `hasCompletedSetupWizard` inside the
// "@otto:app-settings" localStorage blob (packages/app/src/hooks/use-settings/
// storage.ts). A genuinely fresh device persists it as `false`; the index route
// redirects "/" -> "/setup" only when the flag is false AND a host is already
// online at decision time (resolveReadyIndexStartupRoute in
// packages/app/src/navigation/host-runtime-bootstrap.ts).
//
// Why existing specs never hit it: every Playwright test gets a fresh browser
// context (so the flag IS false), but specs either boot straight into host
// routes (openAgentRoute and friends — the gate only runs on the index
// pathname) or resolve "/" before the seeded host's WebSocket finishes
// connecting, so the index redirects to the host root instead. That same race
// is why this spec enters the wizard deterministically through "/setup" rather
// than by sitting on "/".
//
// State safety: the wizard's only writes on this path are device-local
// localStorage settings (interfaceMode + completion flags) — the Team step
// commits nothing unless a generated team is selected, and this walk selects
// none. localStorage is per-test-context, so later specs are unaffected.
const APP_SETTINGS_KEY = "@otto:app-settings";

async function readWizardFlag(page: Page): Promise<boolean | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { hasCompletedSetupWizard?: unknown };
    return typeof parsed.hasCompletedSetupWizard === "boolean"
      ? parsed.hasCompletedSetupWizard
      : null;
  }, APP_SETTINGS_KEY);
}

test.describe("First-time setup wizard", () => {
  test("walks Welcome to Home and does not re-show after completion", async ({ page }) => {
    test.setTimeout(240_000);

    // Boot the app once so the fresh-install settings blob exists, then assert
    // this context really is in the wizard-eligible state.
    await page.goto("/");
    await expect.poll(() => readWizardFlag(page), { timeout: 60_000 }).toBe(false);

    // Deliberately enter the wizard.
    await page.goto("/setup");

    // Welcome bookend.
    await expect(page.getByText("Welcome to Otto", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Mode step: Continue is gated until a mode is chosen.
    await expect(page.getByText("How do you want to use Otto?", { exact: true })).toBeVisible();
    const continueButton = page.getByTestId("setup-continue");
    await expect(continueButton).toBeDisabled();
    await page.getByTestId("setup-interface-mode-developer").click();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Providers step: needs a live host for the snapshot; no selection required.
    await expect(page.getByText("Your providers", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await continueButton.click();

    // Team step: title depends on host feature support; select nothing so
    // Continue commits nothing to the daemon.
    await expect(
      page.getByText(/What kind of team do you want\?|Build your team/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await continueButton.click();

    // Done bookend finishes the wizard and lands on Home (/open-project).
    await expect(page.getByText(/You.re all set/).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await page.waitForURL(/\/open-project(\/|$|\?)/, { timeout: 60_000 });

    // Completion persisted.
    await expect.poll(() => readWizardFlag(page), { timeout: 30_000 }).toBe(true);

    // Idempotent: revisiting the index route resolves away from the wizard.
    await page.goto("/");
    await page.waitForURL((url) => url.pathname !== "/" && url.pathname !== "", {
      timeout: 60_000,
    });
    expect(new URL(page.url()).pathname).not.toBe("/setup");
    await expect(page.getByText("Welcome to Otto", { exact: true })).toHaveCount(0);
  });

  test("Skip setup completes the wizard without walking the steps", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/");
    await expect.poll(() => readWizardFlag(page), { timeout: 60_000 }).toBe(false);

    await page.goto("/setup");
    await expect(page.getByText("Welcome to Otto", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // The Welcome bookend offers the same skip the middle steps carry.
    await page.getByRole("button", { name: "Skip setup", exact: true }).click();
    await page.waitForURL(/\/open-project(\/|$|\?)/, { timeout: 60_000 });
    await expect.poll(() => readWizardFlag(page), { timeout: 30_000 }).toBe(true);
  });
});
