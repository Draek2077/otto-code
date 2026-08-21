import { expect, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../../src/utils/host-routes";
import { createTempGitRepo } from "./workspace";
import { getServerId } from "./server-id";

// ─── Navigation ────────────────────────────────────────────────────────────

/** Navigate to a workspace and wait for the tab bar to appear. */
export async function gotoWorkspace(page: Page, workspaceId: string): Promise<void> {
  const route = buildHostWorkspaceRoute(getServerId(), workspaceId);
  await page.goto(route);
  await waitForTabBarAfterColdNav(page);
}

// A cold deep-link (page.goto straight to a workspace route) relies on the
// layout-reconcile effect, which is gated on route focus + store hydration
// (see workspace-screen.tsx). Under CI load that effect can miss its first
// window on a freshly seeded workspace, leaving `workspaceLayout` null so the
// SplitContainer - and with it the tab strip - never mounts, and the
// 30s wait times out. Reloading re-runs route-focus + reconcile and recovers
// deterministically. In-app navigation (sidebar select) doesn't hit this, so
// only the goto path needs the fallback.
async function waitForTabBarAfterColdNav(page: Page): Promise<void> {
  const tabStrip = visibleWorkspaceTabStrip(page);
  try {
    await expect(tabStrip).toBeVisible({ timeout: 20_000 });
  } catch {
    await page.reload();
    await waitForTabBar(page);
  }
}

function visibleWorkspaceTabStrip(page: Page) {
  return page
    .getByTestId("workspace-tabs-row")
    .or(page.getByTestId("workspace-tabs-rail"))
    .filter({ visible: true })
    .first();
}

// ─── Tab bar queries ───────────────────────────────────────────────────────

/** Wait for the workspace tab bar to be visible. */
export async function waitForTabBar(page: Page): Promise<void> {
  await expect(visibleWorkspaceTabStrip(page)).toBeVisible({
    timeout: 30_000,
  });
}

/** Return all tab test IDs currently in the tab bar. */
export async function getTabTestIds(page: Page): Promise<string[]> {
  const tabs = page
    .locator('[data-testid^="workspace-tab-"]:not([data-testid^="workspace-tab-context-"])')
    .filter({ visible: true });
  const count = await tabs.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await tabs.nth(i).getAttribute("data-testid");
    if (testId) ids.push(testId);
  }
  return ids;
}

/** Return the number of tabs matching a kind prefix (e.g. "launcher", "draft", "terminal", "agent"). */
export async function countTabsOfKind(page: Page, kind: string): Promise<number> {
  const ids = await getTabTestIds(page);
  return ids.filter((id) => id.includes(kind)).length;
}

/** Return the currently active tab's test ID (the one with aria-selected or focus styling). */
export async function getActiveTabTestId(page: Page): Promise<string | null> {
  // Active tab has the focused highlight - check for the aria-selected or data-active attribute
  const activeTab = page
    .locator(
      '[data-testid^="workspace-tab-"]:not([data-testid^="workspace-tab-context-"])[aria-selected="true"]',
    )
    .filter({ visible: true })
    .first();
  if (await activeTab.isVisible().catch(() => false)) {
    return activeTab.getAttribute("data-testid");
  }
  // Fallback: the tab with focused styling
  return null;
}

// ─── Tab actions ───────────────────────────────────────────────────────────

/** Press Cmd+T (macOS) or Ctrl+T (Linux/Windows) to open a new tab. */
export async function pressNewTabShortcut(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+t`);
}

// ─── Tab bar assertions ───────────────────────────────────────────────────

/**
 * Assert the tab bar offers new-agent creation.
 *
 * There is no inline plus button any more - the tab bar's trailing strip only shows *pinned*
 * tools, and the always-present control is the ▾ catalog. So "can this pane make a chat" is
 * answered by opening the catalog and finding the agent row, not by a standalone button.
 */
export async function assertNewChatTileVisible(page: Page): Promise<void> {
  await openNewTabMenu(page);
  await expect(
    page.getByTestId("workspace-new-tab-menu-agent").filter({ visible: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
}

/** Assert the new-tab dropdown trigger is visible in the tab bar. */
export async function assertNewTabMenuTriggerVisible(page: Page): Promise<void> {
  await expect(
    page.getByTestId("workspace-new-tab-menu-trigger").filter({ visible: true }).first(),
  ).toBeVisible();
}

// ─── Tab creation actions ─────────────────────────────────────────────────

/** Open the tab bar's ▾ tool-catalog menu - the entry point for every new-tab action. */
async function openNewTabMenu(page: Page): Promise<void> {
  const trigger = page
    .getByTestId("workspace-new-tab-menu-trigger")
    .filter({ visible: true })
    .first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
}

/** Open the new-tab menu and click the row that creates a draft/chat tab. */
export async function clickNewChat(page: Page): Promise<void> {
  await openNewTabMenu(page);
  const item = page.getByTestId("workspace-new-tab-menu-agent").filter({ visible: true }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

/** Open the new-tab menu and click "New terminal". */
export async function clickNewTerminal(page: Page): Promise<void> {
  await openNewTabMenu(page);
  const item = page
    .getByTestId("workspace-new-tab-menu-terminal")
    .filter({ visible: true })
    .first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

// ─── Tab title assertions ──────────────────────────────────────────────────

/** Wait for any tab in the bar to display the given title text. */
export async function waitForTabWithTitle(
  page: Page,
  title: string | RegExp,
  timeout = 30_000,
): Promise<void> {
  const matcher = typeof title === "string" ? new RegExp(title, "i") : title;
  await expect(
    page
      .locator('[data-testid^="workspace-tab-"]:not([data-testid^="workspace-tab-context-"])')
      .filter({ hasText: matcher })
      .filter({ visible: true })
      .first(),
  ).toBeVisible({ timeout });
}

/** Assert the pane's tab bar carries exactly one new-tab control (the ▾ catalog trigger). */
export async function assertSingleNewTabButton(page: Page): Promise<void> {
  const triggers = page.getByTestId("workspace-new-tab-menu-trigger").filter({ visible: true });
  await expect(triggers.first()).toBeVisible({ timeout: 10_000 });
  expect(await triggers.count()).toBe(1);
}

// ─── No-flash measurement ──────────────────────────────────────────────────

/**
 * Measure the time between clicking a launcher tile and the replacement panel becoming visible.
 * Returns elapsed milliseconds.
 */
export async function measureTileTransition(
  page: Page,
  clickAction: () => Promise<void>,
  successLocator: ReturnType<Page["locator"]>,
  timeout = 5_000,
): Promise<number> {
  const start = Date.now();
  await clickAction();
  await expect(successLocator).toBeVisible({ timeout });
  return Date.now() - start;
}

/**
 * Sample tab IDs at high frequency across a transition to detect blank/intermediate states.
 * Returns all unique snapshots observed.
 */
export async function sampleTabsDuringTransition(
  page: Page,
  action: () => Promise<void>,
  durationMs = 2_000,
  intervalMs = 30,
): Promise<string[][]> {
  const snapshots: string[][] = [];
  const startSampling = async () => {
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      snapshots.push(await getTabTestIds(page));
      await page.waitForTimeout(intervalMs);
    }
  };

  const samplingPromise = startSampling();
  await action();
  await samplingPromise;
  return snapshots;
}

export function terminalSurfaceLocator(page: Page) {
  return page.locator('[data-testid="terminal-surface"]').first();
}

export async function expectAgentTabActive(page: Page, agentId: string): Promise<void> {
  const tabTestId = `workspace-tab-agent_${agentId}`;
  await expect(page.getByTestId(tabTestId).filter({ visible: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(getActiveTabTestId(page)).resolves.toBe(tabTestId);
}

// ─── Workspace setup ───────────────────────────────────────────────────────

/** Create a temp git repo and return its path with a cleanup function. */
export async function createWorkspace(
  prefix = "launcher-e2e-",
): ReturnType<typeof createTempGitRepo> {
  return createTempGitRepo(prefix);
}
