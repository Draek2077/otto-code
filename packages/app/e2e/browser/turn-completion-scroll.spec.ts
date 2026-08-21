import { test, expect } from "../support/fixtures";
import { awaitAssistantMessage, expectAgentIdle } from "../support/helpers/agent-stream";
import {
  readScrollMetrics,
  scrollChatAwayFromBottom,
  waitForScrollableChat,
} from "../support/helpers/agent-bottom-anchor";
import { seedAppSettings } from "../support/helpers/settings";
import { startRunningMockAgent } from "../support/helpers/composer";

async function disableActionGrouping(page: import("@playwright/test").Page): Promise<void> {
  await seedAppSettings(page, { groupConsecutiveActions: false });
}

test.describe("turn completion scroll", () => {
  test("detached reader survives turn completion without jumping to top", async ({ page }) => {
    test.setTimeout(60_000);
    await disableActionGrouping(page);
    const agent = await startRunningMockAgent(page, {
      prefix: "turn-complete-scroll-",
      model: "ten-second-stream",
      prompt: "Stream for turn-completion scroll test.",
    });
    try {
      await awaitAssistantMessage(page);
      await waitForScrollableChat(page, { minScrollableDistance: 200, timeout: 15_000 });
      const detached = await scrollChatAwayFromBottom(page, {
        deltaY: -900,
        minDistanceFromBottom: 150,
      });
      console.log("detached metrics", detached);
      await expectAgentIdle(page, 30_000);
      const settled = await readScrollMetrics(page);
      console.log("settled metrics", settled);
      // If the reader was thrown to the top, offsetY collapses toward 0 even
      // though they never asked to move.
      expect(settled.offsetY).toBeGreaterThan(detached.offsetY - 100);
    } finally {
      await agent.cleanup();
    }
  });
});
