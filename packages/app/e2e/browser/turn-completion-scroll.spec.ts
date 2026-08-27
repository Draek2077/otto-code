import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import {
  readScrollMetrics,
  scrollChatAwayFromBottom,
  waitForScrollableChat,
} from "../support/helpers/agent-bottom-anchor";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

interface DetachedScrollTrackerSeed {
  baselineTop: number;
  marker: string;
}

interface DetachedScrollTrackerResult {
  anchorMissing: boolean;
  childListMutationCount: number;
  maximumDrift: number;
  mutationCount: number;
  samples: number[];
}

type DetachedScrollTrackerWindow = typeof window & {
  __ottoDetachedScrollTracker?: {
    read(): DetachedScrollTrackerResult;
    stop(): void;
  };
};

async function markDetachedAnchor(page: Page): Promise<DetachedScrollTrackerSeed> {
  return page
    .locator('[data-testid="agent-chat-scroll"]:visible')
    .filter({
      has: page.locator('[data-testid="assistant-message"], [data-testid="user-message"]'),
    })
    .first()
    .evaluate((scrollElement) => {
      const scroll = scrollElement as HTMLElement;
      const scrollBounds = scroll.getBoundingClientRect();
      const rows = Array.from(scroll.querySelectorAll<HTMLElement>("[data-history-row-id]"));
      const anchor = rows.find((row) => {
        const bounds = row.getBoundingClientRect();
        const readingLine = scrollBounds.top + 80;
        return bounds.top <= readingLine && bounds.bottom > readingLine;
      });
      if (!anchor) {
        throw new Error("Expected a history row at the detached reader's reading line");
      }
      const marker = `detached-scroll-anchor-${Date.now()}`;
      anchor.dataset.detachedScrollAnchor = marker;
      return {
        baselineTop: anchor.getBoundingClientRect().top,
        marker,
      };
    });
}

async function installDetachedScrollTracker(
  page: Page,
  seed: DetachedScrollTrackerSeed,
): Promise<void> {
  await page.evaluate(({ marker, baselineTop }) => {
    const samples: number[] = [];
    let maximumDrift = 0;
    let anchorMissing = false;
    let mutationCount = 0;
    let childListMutationCount = 0;
    const transcript = document
      .querySelector<HTMLElement>(`[data-detached-scroll-anchor="${marker}"]`)
      ?.closest<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!transcript) throw new Error("Detached transcript was not available for observation");
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
      childListMutationCount += records.filter((record) => record.type === "childList").length;
    });
    observer.observe(transcript, { characterData: true, childList: true, subtree: true });
    const sample = () => {
      const anchor = document.querySelector<HTMLElement>(
        `[data-detached-scroll-anchor="${marker}"]`,
      );
      const scroll = anchor?.closest<HTMLElement>('[data-testid="agent-chat-scroll"]');
      if (!anchor || !scroll) {
        anchorMissing = true;
        return;
      }
      const drift = Math.abs(anchor.getBoundingClientRect().top - baselineTop);
      samples.push(drift);
      maximumDrift = Math.max(maximumDrift, drift);
    };
    const timer = window.setInterval(sample, 16);
    Object.assign(window, {
      __ottoDetachedScrollTracker: {
        read: () => ({
          anchorMissing,
          childListMutationCount,
          maximumDrift,
          mutationCount,
          samples,
        }),
        stop: () => {
          window.clearInterval(timer);
          observer.disconnect();
        },
      },
    });
  }, seed);
}

async function stopDetachedScrollTracker(page: Page): Promise<DetachedScrollTrackerResult> {
  return page.evaluate(() => {
    const installedTracker = (window as DetachedScrollTrackerWindow).__ottoDetachedScrollTracker;
    if (!installedTracker) throw new Error("Detached scroll tracker was not installed");
    installedTracker.stop();
    return installedTracker.read();
  });
}

test.describe("turn completion scroll", () => {
  test("bottom mutations never move a detached reader's visible row", async ({ page }) => {
    test.slow();
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "turn-complete-scroll-",
      title: "Detached scroll mutation stability",
      model: "ten-second-stream",
      initialPrompt: "synthetic-history: 140\nsynthetic-seed: 48151623",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 60_000);
      await openAgentRoute(page, agent);
      await waitForScrollableChat(page, { minScrollableDistance: 2_000, timeout: 30_000 });
      await scrollChatAwayFromBottom(page, {
        deltaY: -1_500,
        minDistanceFromBottom: 800,
      });

      const trackerSeed = await markDetachedAnchor(page);
      await installDetachedScrollTracker(page, trackerSeed);

      await agent.client.sendAgentMessage(
        agent.agentId,
        "emit 500 agent stream updates while the reader stays detached",
      );
      await expectAgentIdle(page, 30_000);
      const result = await stopDetachedScrollTracker(page);

      expect(result.anchorMissing).toBe(false);
      expect(result.samples.length).toBeGreaterThan(5);
      expect(result.mutationCount).toBeGreaterThan(0);
      expect(result.childListMutationCount).toBeGreaterThan(0);
      expect(result.maximumDrift).toBeLessThanOrEqual(1);
      expect((await readScrollMetrics(page)).distanceFromBottom).toBeGreaterThan(800);
    } finally {
      await agent.cleanup();
    }
  });
});
