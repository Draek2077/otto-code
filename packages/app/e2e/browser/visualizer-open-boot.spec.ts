import { test, expect } from "../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";
import { waitForTabBar } from "../support/helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { composerLocator } from "../support/helpers/composer";
import { seedAppSettings } from "../support/helpers/settings";
import {
  expectVisualizerBooted,
  openVisualizerFromHeader,
  visualizerChatsTrigger,
  visualizerIframe,
} from "../support/helpers/visualizer";

const scrollableDistance = (scroll: Locator) =>
  scroll.evaluate((node) => node.scrollHeight - node.clientHeight);
const distanceFromBottom = (scroll: Locator) =>
  scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
// Read the empty left gutter at both seams. A wrong-colored overlay makes its
// outer edge brighter than the adjacent canvas. Median samples ignore stars.
async function expectSeamsBlend(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const median = (start: number, channel: number) => {
    const values = Array.from(
      { length: 6 },
      (_, index) => data[((start + index) * info.width + 3) * info.channels + channel],
    ).sort((a, b) => a - b);
    return values[3];
  };
  for (const [edge, adjacent] of [
    [0, 24],
    [info.height - 6, info.height - 30],
  ]) {
    for (const channel of [0, 1, 2]) {
      expect(Math.abs(median(edge, channel) - median(adjacent, channel))).toBeLessThanOrEqual(1);
    }
  }
}
const observeBackgroundSession = (page: Page) =>
  page.evaluate(() => {
    window.addEventListener("message", (event) => {
      const guest = document.querySelector<HTMLIFrameElement>(
        '[data-testid="chat-visualizer-background"] iframe',
      );
      if (event.source === guest?.contentWindow && event.data?.type === "session-state") {
        document.documentElement.dataset.backgroundSession = event.data.selectedId ?? "";
      }
    });
  });
const visibleContentPoint = (content: Locator) =>
  content.evaluateAll((nodes) => {
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const scroll = node.closest('[data-testid="agent-chat-scroll"]')?.getBoundingClientRect();
      if (!scroll) continue;
      const top = Math.max(rect.top, scroll.top + 40);
      const bottom = Math.min(rect.bottom, scroll.bottom - 24);
      // Long messages may exceed the viewport. Use an actual visible interior
      // point without Locator.click scrolling the bubble's center into view.
      if (bottom - top >= 24 && rect.width >= 24) {
        return { x: rect.left + 8, y: (top + bottom) / 2 };
      }
    }
    return null;
  });

// P0: opening the Visualizer tab boots the vendored canvas page. The boot
// proof uses bridge/DOM state (docs/visualizer.md "The bridge contract"); the
// background test additionally samples empty gutter pixels at both chat seams:
//   1. the native Otto toolbar renders above the tab,
//   2. the sandboxed guest iframe attaches (visualizer-view.web.tsx),
//   3. the toolbar's chats dropdown lists the workspace's chat - which requires
//      the guest to have booted, sent `ready`, received the adapter's
//      `session-started`, and mirrored `session-state` back to the host.

test.describe("Visualizer open + boot", () => {
  test.describe.configure({ timeout: 180_000 });

  test("chat background stays fixed while the conversation scrolls, peeks, and hides", async ({
    page,
  }, testInfo) => {
    test.slow();
    await seedAppSettings(page, {
      colorSchemeMode: "dark",
      darkTheme: "obsidian",
      blackTabBackground: true,
    });
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "vis-background-",
      title: "Background proof",
      initialPrompt: "synthetic-history: 80\nsynthetic-seed: 42017",
    });
    try {
      await mock.client.waitForFinish(mock.agentId, 60_000);
      await openAgentRoute(page, mock);
      await waitForTabBar(page);
      const topFade = page.getByTestId("chat-seam-fade-top").filter({ visible: true }).first();
      const bottomFade = page
        .getByTestId("chat-seam-fade-bottom")
        .filter({ visible: true })
        .first();
      const normalTopFade = await topFade.evaluate(
        (node) => getComputedStyle(node).backgroundImage,
      );
      const normalBottomFade = await bottomFade.evaluate(
        (node) => getComputedStyle(node).backgroundImage,
      );
      await page.getByTestId("workspace-visualizer-button").filter({ visible: true }).click();
      await expect(
        page.getByTestId("visualizer-toolbar-audio").filter({ visible: true }),
      ).toBeVisible({ timeout: 90_000 });
      await expectVisualizerBooted(page, "Background proof");
      await observeBackgroundSession(page);
      await page.getByTestId("visualizer-toolbar-background").click();
      const background = page.getByTestId("chat-visualizer-background");
      const viewport = page.getByTestId("chat-visualizer-viewport").filter({ has: background });
      const foreground = viewport.getByTestId("chat-visualizer-conversation");
      const scroll = viewport.getByTestId("agent-chat-scroll");
      await expect(background).toBeVisible();
      await expect(visualizerIframe(page)).toHaveCount(1);
      await expect(page.getByTestId("visualizer-toolbar-background")).toHaveCount(0);
      await expect(page.getByTestId("visualizer-toolbar-audio")).toHaveCount(0);
      const guest = page.frameLocator('iframe[title="visualizer"]');
      await expect(guest.locator("canvas").first()).toBeVisible();
      await expect(guest.getByText("LIVE", { exact: true })).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-background-session", mock.agentId);
      const stageColor = await viewport.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(stageColor).not.toBe("rgba(0, 0, 0, 0)");
      await expect(viewport.getByTestId("chat-seam-fade-top")).toHaveCount(0);
      await expect(viewport.getByTestId("chat-seam-fade-bottom")).toHaveCount(0);
      const mask = viewport.getByTestId("chat-transcript-mask");
      await expect(mask).not.toHaveCSS("mask-image", "none");
      await composerLocator(page).hover();
      await expect(foreground).toHaveCSS("opacity", "1");
      await expectSeamsBlend(
        await scroll.screenshot({ path: testInfo.outputPath("background-seams.png") }),
      );
      const bounds = await background.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeLessThan(page.viewportSize()!.height);
      const composer = viewport.getByTestId("chat-visualizer-composer");
      const composerBounds = await composer.boundingBox();
      expect(composerBounds!.y).toBeGreaterThan(bounds!.y);
      expect(composerBounds!.y + composerBounds!.height).toBeCloseTo(bounds!.y + bounds!.height, 0);
      const scroller = await scroll.elementHandle();
      expect(scroller).not.toBeNull();
      await expect.poll(() => scrollableDistance(scroll)).toBeGreaterThan(500);
      await scroll.hover();
      await page.mouse.wheel(0, -700);
      await expect.poll(() => distanceFromBottom(scroll)).toBeGreaterThan(300);
      expect(await background.boundingBox()).toEqual(bounds);

      // Side gutters remain usable despite messages sitting right beside them.
      const gutter = { x: bounds!.x + 3, y: bounds!.y + bounds!.height / 2 };
      await page.mouse.move(gutter.x, gutter.y);
      await expect(foreground).toHaveCSS("opacity", "0.25");
      const bubble = viewport.locator("[data-chat-visualizer-content]").filter({ visible: true });
      const visibleBubble = await visibleContentPoint(bubble);
      expect(visibleBubble).not.toBeNull();
      await page.mouse.move(visibleBubble!.x, visibleBubble!.y);
      await expect(foreground).toHaveCSS("opacity", "1");
      await page.mouse.click(visibleBubble!.x, visibleBubble!.y);
      await expect(foreground).toHaveCSS("opacity", "1");
      const scrollTop = await scroll.evaluate((node) => node.scrollTop);
      await page.mouse.click(gutter.x, gutter.y);
      await expect(foreground).toHaveCSS("opacity", "0");
      await expect(background).toHaveCSS("opacity", "1");
      await page.screenshot({ path: testInfo.outputPath("background-revealed.png") });
      await expect(foreground).toHaveAttribute("inert", "");
      await expect(composerLocator(page)).toBeEditable();
      await composerLocator(page).fill("Composer remains usable over the graph");
      await expect(composerLocator(page)).toHaveValue("Composer remains usable over the graph");
      await composerLocator(page).fill("");
      await expect(page.getByTestId("chat-visualizer-toggle")).toHaveAttribute(
        "aria-label",
        "Show conversation",
      );
      await page.mouse.click(gutter.x, gutter.y);
      await expect(foreground).toHaveCSS("opacity", "1");
      expect(await scroller!.evaluate((node) => node.isConnected)).toBe(true);
      expect(await scroll.evaluate((node) => node.scrollTop)).toBe(scrollTop);
      await page.getByTestId("chat-visualizer-toggle").click();
      await expect(foreground).toHaveCSS("opacity", "0");
      await page.keyboard.press("Escape");
      await expect(foreground).toHaveCSS("opacity", "1");
      await page.screenshot({ path: testInfo.outputPath("background-reading.png") });

      await page.setViewportSize({ width: 1100, height: 760 });
      await expect
        .poll(async () => (await background.boundingBox())?.width)
        .not.toBe(bounds!.width);
      const resized = await background.boundingBox();
      expect(resized!.height).toBeLessThan(760);
      await page.getByTestId("chat-visualizer-close").click();
      await expect(background).toHaveCount(0);
      await expect(topFade).toHaveCSS("background-image", normalTopFade);
      await expect(bottomFade).toHaveCSS("background-image", normalBottomFade);
      await expect(
        page.getByTestId("chat-transcript-mask").filter({ visible: true }).first(),
      ).toHaveCSS("mask-image", "none");
      await page.getByTestId("workspace-visualizer-button").filter({ visible: true }).click();
      await expect(background).toBeVisible();
      await page.getByTestId("chat-visualizer-expand").click();
      await expect(background).toHaveCount(0);
      await expect(
        page.getByTestId("visualizer-toolbar-audio").filter({ visible: true }),
      ).toBeVisible({ timeout: 90_000 });
      // Reopening uses the existing companion split. At this resized width the
      // chat picker can shrink out of view; its mirror still proves guest boot.
      await expect(page.getByTestId("visualizer-toolbar-chats-trigger")).toContainText(
        "Background proof",
        { timeout: 60_000 },
      );
      await expect(visualizerIframe(page)).toHaveCount(1);
    } finally {
      await mock.cleanup();
    }
  });

  test("opening the Visualizer from the workspace header boots the canvas page", async ({
    page,
  }) => {
    // Session labels are capped at 24 chars in the toolbar mirror
    // (truncateSessionLabel) - keep the title short so it survives verbatim.
    const title = `VisBoot ${Date.now().toString(36).slice(-6)}`;
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "vis-boot-",
      title,
    });

    try {
      await openAgentRoute(page, {
        workspaceId: mock.workspaceId,
        agentId: mock.agentId,
      });
      await waitForTabBar(page);

      // Before opening: no guest iframe is mounted anywhere (the render bundle
      // stays behind its lazy boundary until a Visualizer tab exists).
      await expect(visualizerIframe(page)).toHaveCount(0);

      await openVisualizerFromHeader(page);

      // Boot: iframe attached, no load-failure state, session mirror live.
      await expectVisualizerBooted(page, title);

      // The chats dropdown is enabled once the mirror carries a session (it is
      // disabled in the "No chats" empty state).
      await expect(visualizerChatsTrigger(page)).toBeEnabled();
    } finally {
      await mock.cleanup();
    }
  });
});
