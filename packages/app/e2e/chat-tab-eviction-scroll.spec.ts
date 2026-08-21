import { test, expect, type Page } from "./fixtures";
import { expectAgentIdle } from "./helpers/agent-stream";
import {
  readScrollMetrics,
  scrollAgentChatToBottom,
  waitForScrollableChat,
  type ScrollMetrics,
} from "./helpers/agent-bottom-anchor";
import { moneyShot } from "./helpers/evidence";
import { buildAgentRoute, openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { seedAppSettings } from "./helpers/settings";

// A pane keeps `mountedTabLimit` tabs mounted and unmounts the rest. Two is the
// floor, so visiting both siblings below is guaranteed to evict the first tab
// and make the return a fresh mount rather than a `display: none` toggle. That
// distinction is the whole test: the retained path already held the position,
// and only the remount path threw the reader back to the bottom.
const MOUNTED_TAB_LIMIT = 2;
const HISTORY_ITEMS = 90;
const DETACH_DISTANCE_PX = 1500;

function chatScroll(page: Page) {
  return page
    .locator('[data-testid="agent-chat-scroll"]:visible')
    .filter({
      has: page.locator('[data-testid="assistant-message"], [data-testid="user-message"]'),
    })
    .first();
}

/** Wheel up in small steps until the reader is the requested distance from the bottom. */
async function detachTo(page: Page, targetDistance: number): Promise<ScrollMetrics> {
  const box = await chatScroll(page).boundingBox();
  expect(box, "Expected a visible chat transcript to scroll").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let step = 0; step < 60; step += 1) {
    const metrics = await readScrollMetrics(page);
    if (metrics.distanceFromBottom >= targetDistance || metrics.offsetY <= 5) {
      break;
    }
    await page.mouse.wheel(0, -Math.min(300, targetDistance - metrics.distanceFromBottom + 100));
    await page.waitForTimeout(120);
  }
  return readScrollMetrics(page);
}

/** Wait until lazy row measurement stops changing the transcript's height. */
async function waitForStableContent(page: Page): Promise<ScrollMetrics> {
  let previousHeight = -1;
  let stableSamples = 0;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const metrics = await readScrollMetrics(page);
    if (metrics.contentHeight === previousHeight) {
      stableSamples += 1;
      if (stableSamples >= 4) {
        return metrics;
      }
    } else {
      stableSamples = 0;
      previousHeight = metrics.contentHeight;
    }
  }
  return readScrollMetrics(page);
}

test.describe("chat tab eviction scroll", () => {
  test("detached reader keeps their place when the tab is evicted and remounted", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "tab-eviction-scroll-",
      title: "Eviction scroll",
      model: "synthetic-history",
    });
    try {
      const siblings = [];
      for (let index = 0; index < 2; index += 1) {
        siblings.push(
          await workspace.client.createAgent({
            provider: "mock",
            cwd: workspace.cwd,
            workspaceId: workspace.workspaceId,
            title: `Eviction sibling ${index}`,
            modeId: "load-test",
            model: "ten-second-stream",
          }),
        );
      }

      await seedAppSettings(page, { mountedTabLimit: MOUNTED_TAB_LIMIT });
      await openAgentRoute(page, workspace);
      for (const sibling of siblings) {
        await page.goto(buildAgentRoute(workspace.workspaceId, sibling.id));
        await page.waitForTimeout(1_500);
      }

      const tabs = page.locator('[data-testid^="workspace-tab-agent_"]').filter({ visible: true });
      await expect(tabs).toHaveCount(3);
      const clickTab = async (agentId: string) => {
        await page
          .locator(`[data-testid="workspace-tab-agent_${agentId}"]`)
          .filter({ visible: true })
          .first()
          .click();
      };

      await clickTab(workspace.agentId);
      await workspace.client.sendAgentMessage(
        workspace.agentId,
        `synthetic-history: ${HISTORY_ITEMS}`,
      );
      await expectAgentIdle(page, 180_000);
      await waitForScrollableChat(page, { minScrollableDistance: 2_000, timeout: 60_000 });
      await waitForStableContent(page);

      const detached = await detachTo(page, DETACH_DISTANCE_PX);
      expect(
        detached.distanceFromBottom,
        "Expected the reader to be scrolled well away from the bottom",
      ).toBeGreaterThan(DETACH_DISTANCE_PX - 200);

      for (const sibling of siblings) {
        await clickTab(sibling.id);
        await page.waitForTimeout(1_500);
      }
      await clickTab(workspace.agentId);
      await page.waitForTimeout(4_000);

      const restored = await readScrollMetrics(page);
      // Before the fix this landed at the bottom - distanceFromBottom 0 - because
      // a fresh mount always took the bottom and nothing carried the reader's
      // ownership across the unmount.
      expect(
        restored.distanceFromBottom,
        `Expected the remounted transcript to stay scrolled up: ${JSON.stringify({
          detached,
          restored,
        })}`,
      ).toBeGreaterThan(DETACH_DISTANCE_PX / 2);
      expect(
        Math.abs(restored.offsetY - detached.offsetY),
        `Expected the remounted transcript near the position it was left at: ${JSON.stringify({
          detached,
          restored,
        })}`,
      ).toBeLessThan(400);
      await moneyShot(
        page,
        "A chat tab evicted from its pane returns to the position it was left at",
      );

      // Returning to the bottom is an explicit request to follow output, so the
      // next remount must not be pulled back up the transcript.
      await scrollAgentChatToBottom(page);
      await page.waitForTimeout(1_000);
      for (const sibling of siblings) {
        await clickTab(sibling.id);
        await page.waitForTimeout(1_500);
      }
      await clickTab(workspace.agentId);
      await page.waitForTimeout(4_000);

      const followed = await readScrollMetrics(page);
      expect(
        followed.distanceFromBottom,
        `Expected a following chat to return at the bottom: ${JSON.stringify(followed)}`,
      ).toBeLessThanOrEqual(72);
    } finally {
      await workspace.cleanup();
    }
  });
});
