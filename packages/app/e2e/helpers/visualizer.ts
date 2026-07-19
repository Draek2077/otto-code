import { expect, type Locator, type Page } from "@playwright/test";

// Shared locators/flows for the Visualizer specs. Everything here asserts on
// host-side DOM only — the vendored canvas is a sandboxed iframe whose
// rendering output is never inspected (WebGL/canvas pixels are out of bounds
// under headless Chromium). The bridge-observable boot signal is the native
// Otto toolbar's chats dropdown: its entries mirror the guest page's live
// session list (page -> host `session-state`, see docs/visualizer.md "The
// bridge contract"), so a listed chat proves the guest booted, completed the
// `ready` handshake, and round-tripped the adapter's session registration.

/** Workspace-header entry point (developer mode + desktop + feature enabled). */
export function visualizerHeaderButton(page: Page): Locator {
  return page.locator('[data-testid="workspace-visualizer-button"]:visible').first();
}

/** The Visualizer workspace tab chip (deterministic id — one per workspace). */
export function visualizerTabChip(page: Page): Locator {
  return page.locator('[data-testid="workspace-tab-visualizer"]:visible').first();
}

/** All (visible or not) Visualizer tab chips — for asserting removal. */
export function allVisualizerTabChips(page: Page): Locator {
  return page.locator('[data-testid="workspace-tab-visualizer"]:visible');
}

/** The native Otto toolbar's chats dropdown trigger (SelectField). */
export function visualizerChatsTrigger(page: Page): Locator {
  return page.locator('[data-testid="visualizer-toolbar-chats-trigger"]:visible').first();
}

/** The sandboxed guest iframe (web embed — visualizer-view.web.tsx). */
export function visualizerIframe(page: Page): Locator {
  return page.locator('iframe[title="visualizer"]');
}

/** The pane tab-row that contains the Visualizer tab (desktop split layout). */
export function visualizerPaneTabsRow(page: Page): Locator {
  return page
    .locator('[data-testid="workspace-tabs-row"]')
    .filter({ has: page.getByTestId("workspace-tab-visualizer") })
    .filter({ visible: true })
    .first();
}

/**
 * Open the Visualizer from the workspace header button and wait for the tab +
 * native toolbar to appear. Does not wait for the guest boot — pair with
 * {@link expectVisualizerBooted} for that.
 */
export async function openVisualizerFromHeader(page: Page): Promise<void> {
  const button = visualizerHeaderButton(page);
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect(visualizerTabChip(page)).toBeVisible({ timeout: 30_000 });
  // The native toolbar renders unconditionally at the top of the tab — its
  // audio toggle is one of the always-visible controls (never collapsed).
  await expect(
    page.locator('[data-testid="visualizer-toolbar-audio"]:visible').first(),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Assert the guest page booted: iframe attached, no load-failure state, and the
 * chats dropdown shows the given chat title (the session-state mirror round
 * trip — guest `ready` -> adapter `session-started` -> guest `session-state`
 * -> toolbar). Never inspects rendering output.
 */
export async function expectVisualizerBooted(page: Page, chatTitle: string): Promise<void> {
  await expect(visualizerIframe(page)).toBeAttached({ timeout: 30_000 });
  // en.ts workspace.visualizer.loadFailedTitle — shown by the ready-handshake
  // watchdog when the guest never boots.
  await expect(page.getByText("The Visualizer couldn't start")).toHaveCount(0);
  await expect(visualizerChatsTrigger(page)).toContainText(chatTitle, { timeout: 60_000 });
}

/** Open the chats dropdown and return the combobox dialog locator. */
export async function openVisualizerChatsDropdown(page: Page): Promise<Locator> {
  await visualizerChatsTrigger(page).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

export async function closeVisualizerChatsDropdown(page: Page, dialog: Locator): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
}

/** Toggle Settings visibility with the app-wide keyboard shortcut. */
export async function pressSettingsToggleShortcut(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+Comma`);
}

/**
 * From anywhere inside /settings, open the Visualizer section via its sidebar
 * row (developer-mode-only row; raw-English label from the feature catalog).
 */
export async function openVisualizerSettingsSection(page: Page): Promise<void> {
  const sidebar = page.getByTestId("settings-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 15_000 });
  await sidebar.getByRole("button", { name: "Visualizer", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/visualizer$/, { timeout: 15_000 });
  await expect(page.getByTestId("settings-visualizer-enable-switch")).toBeVisible({
    timeout: 15_000,
  });
}

/** Read the persisted device-local app settings blob. */
export async function readAppSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("@otto:app-settings");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  });
}
