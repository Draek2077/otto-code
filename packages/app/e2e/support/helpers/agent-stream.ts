import { expect, type Page } from "@playwright/test";
import { readScrollMetrics, waitForContentGrowth, expectNearBottom } from "./agent-bottom-anchor";

export async function awaitAssistantMessage(page: Page, hasText?: string | RegExp): Promise<void> {
  const messages = page.getByTestId("assistant-message");
  const target = hasText === undefined ? messages.first() : messages.filter({ hasText }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
}

export async function awaitToolCall(page: Page, toolName: string | RegExp): Promise<void> {
  await expect(
    page.getByTestId("tool-call-badge").filter({ hasText: toolName }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

export async function expectAgentIdle(page: Page, timeout = 30_000): Promise<void> {
  await expect(
    page.getByRole("button", {
      name: /stop agent|canceling agent|interrupt agent|send and interrupt/i,
    }),
  ).toHaveCount(0, { timeout });
}

// The working indicator is an animated spinner View - no semantic ARIA role, testId is correct.
export async function expectInlineWorkingIndicator(page: Page): Promise<void> {
  await expect(page.getByTestId("turn-working-indicator")).toBeVisible({ timeout: 30_000 });
}

export async function expectRunningAgentChrome(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toBeVisible({
    timeout: 30_000,
  });
  await expectInlineWorkingIndicator(page);
}

export async function expectAgentReadyToInterrupt(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Canceling agent", exact: true })).toHaveCount(0);
}

export async function expectVisibleAgentSurfacesIdle(page: Page): Promise<void> {
  const visibleAgentTab = page
    .getByTestId(/^workspace-tab-agent_/)
    .filter({ visible: true })
    .first();

  await expect(visibleAgentTab).toBeVisible({ timeout: 30_000 });
  await expect(visibleAgentTab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
}

export async function expectAgentSurfacesIdle(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
  await expectTurnCopyButton(page);
}

export async function expectTurnCopyButton(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Copy turn" }).first()).toBeVisible({
    timeout: 30_000,
  });
}

// The mock stream spends long stretches feeding content that does NOT grow the
// transcript: reasoning lands in a collapsed card that scrolls internally (804px
// of text inside a 64px box), and tool cards do the same with their output. So
// the scroll container can sit at exactly its own client height for far longer
// than the default 10s expect window while the stream is perfectly healthy. Wait
// long enough to reach the next burst of assistant text instead; the spec's own
// budget is 120s, and a failure now names the box it measured.
const CONTENT_GROWTH_TIMEOUT_MS = 45_000;

export async function expectScrollFollowsNewContent(page: Page): Promise<void> {
  const { contentHeight } = await readScrollMetrics(page);
  await waitForContentGrowth(page, contentHeight, { timeout: CONTENT_GROWTH_TIMEOUT_MS });
  await expectNearBottom(page);
}
