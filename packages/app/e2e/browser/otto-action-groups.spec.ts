import { test, expect } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedLongMockAgentTimeline } from "../support/helpers/timeline-pagination";
import { expectComposerVisible } from "../support/helpers/composer";

for (const viewport of [
  { width: 1280, height: 600 },
  { width: 390, height: 520 },
]) {
  test(`groups actions without moving a detached reader at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        "@otto:app-settings",
        JSON.stringify({
          toolCallDetailLevel: "detailed",
          groupConsecutiveActions: true,
        }),
      ),
    );
    // Real existing history is needed: the collapsed live turn may fit the viewport.
    const agent = await seedLongMockAgentTimeline({ turns: 8 });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise grouped actions.");
      await agent.client.waitForFinish(agent.agentId, 20_000);
      const group = page.getByTestId("action-group-badge").first();
      await expect(group).toBeVisible();
      await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
      const header = group.getByRole("button").first();
      await header.focus();
      const headerBefore = await header.boundingBox();
      await page.keyboard.press("Enter");
      await expect(group.getByTestId("tool-call-badge").first()).toBeVisible();
      await expect(group.getByTestId("tool-call-badge").first()).toBeInViewport();
      await expect
        .poll(async () => {
          const after = await header.boundingBox();
          return after && headerBefore ? Math.abs(after.y - headerBefore.y) : Infinity;
        })
        .toBeLessThan(2);
      await page.screenshot({ path: testInfo.outputPath("expanded-actions.png") });
      await header.focus();
      await page.keyboard.press("Enter");
      await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);

      const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
      await expect
        .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight))
        .toBeGreaterThan(10);
      const rect = await scroll.boundingBox();
      if (!rect) throw new Error("chat scroller is not mounted");
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeLessThan(2);
      await scroll.evaluate((node) => {
        const start = node.scrollTop;
        node.setAttribute("data-grouping-scroll-start", String(start));
        node.setAttribute("data-grouping-scroll-max-delta", "0");
        node.addEventListener("scroll", () => {
          const previous = Number(node.getAttribute("data-grouping-scroll-max-delta"));
          node.setAttribute(
            "data-grouping-scroll-max-delta",
            String(Math.max(previous, Math.abs(node.scrollTop - start))),
          );
        });
      });
      // An externally delivered turn must not take a detached reader to the end.
      // This drives the real provider -> daemon -> store -> grouping -> viewport path.
      await agent.client.sendAgentMessage(agent.agentId, "Continue while I read older messages.");
      await agent.client.waitForFinish(agent.agentId, 20_000);
      const metrics = await scroll.evaluate((node) => ({
        before: Number(node.getAttribute("data-grouping-scroll-start")),
        after: node.scrollTop,
        maxDelta: Number(node.getAttribute("data-grouping-scroll-max-delta")),
      }));
      expect(metrics.maxDelta).toBeLessThan(2);
      expect(Math.abs(metrics.after - metrics.before)).toBeLessThan(2);
      await testInfo.attach("grouping-scroll-metrics", {
        body: JSON.stringify({ viewport, ...metrics }),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("detached-reader.png") });

      await page.reload();
      await expectComposerVisible(page);
      await expect(page.getByTestId("action-group-badge").first()).toBeVisible();
      await expect(page.getByTestId("action-group-members")).toHaveCount(0);
    } catch (error) {
      await page
        .screenshot({ path: testInfo.outputPath("before-cleanup.png") })
        .catch(() => undefined);
      await testInfo.attach("group-markup-before-cleanup", {
        body: await page
          .getByTestId("action-group-badge")
          .first()
          .evaluate((node) => node.outerHTML)
          .catch(() => "Group not mounted"),
        contentType: "text/html",
      });
      throw error;
    } finally {
      await agent.cleanup();
    }
  });
}
