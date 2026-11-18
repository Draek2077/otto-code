import type { Locator } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  seedAgentProfiles,
  openModelPicker,
  applyProfileFromPicker,
} from "../support/helpers/agent-profiles";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectComposerVisible } from "../support/helpers/composer";
import { openMobileAgentSidebar, closeMobileAgentSidebar } from "../support/helpers/sidebar";

const profile = {
  id: "otto-identity-profile",
  name: "Identity proof",
  provider: "mock",
  model: "one-minute-stream",
  modeId: "load-test",
  spinner: { glowA: "#123456", glowB: "#abcdef" },
};
async function stopColors(locator: Locator) {
  return locator
    .locator("stop")
    .evaluateAll((stops) =>
      [...new Set(stops.map((stop) => getComputedStyle(stop).stopColor))].sort(),
    );
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`keeps workspace blue and assigned Profile colors through reload at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const seed = await seedAgentProfiles([profile]);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "otto-chat-identity-",
      title: "Chat identity",
      model: "one-minute-stream",
      modeId: "load-test",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openModelPicker(page);
      await applyProfileFromPicker(page, profile.name);
      await workspace.client.sendAgentMessage(
        workspace.agentId,
        "Show the assigned Profile activity colors.",
      );
      const working = page.locator('[data-testid="turn-working-spinner"]:visible').first();
      const tab = page.locator('[data-testid="otto-chat-tab-spinner"]:visible').first();
      const colors = ["rgb(171, 205, 239)", "rgb(18, 52, 86)"];
      await expect(working).toBeVisible();
      await expect.poll(() => stopColors(working)).toEqual(colors);
      await expect.poll(() => stopColors(tab)).toEqual(colors);
      await page.screenshot({ path: testInfo.outputPath("profile-chat-colors.png") });

      if (viewport.width < 720) await openMobileAgentSidebar(page);
      const dot = page.locator('[data-testid="otto-activity-center-dot"]:visible').first();
      await expect(dot).toBeVisible();
      const blue = await dot.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(["rgb(2, 132, 199)", "rgb(56, 189, 248)"]).toContain(blue);
      const ring = dot.locator("..");
      await expect.poll(() => stopColors(ring)).toEqual([blue]);
      const geometry = await dot.evaluate((node) => {
        const center = node.getBoundingClientRect();
        const frame = node.parentElement!.getBoundingClientRect();
        return {
          width: center.width,
          dx: center.x + center.width / 2 - frame.x - frame.width / 2,
          dy: center.y + center.height / 2 - frame.y - frame.height / 2,
        };
      });
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.dx).toBeCloseTo(0, 1);
      expect(geometry.dy).toBeCloseTo(0, 1);
      await page.screenshot({ path: testInfo.outputPath("workspace-blue-center.png") });
      if (viewport.width < 720) await closeMobileAgentSidebar(page);

      await page.reload();
      await expectComposerVisible(page);
      await expect(working).toBeVisible();
      await expect.poll(() => stopColors(working)).toEqual(colors);
      await expect.poll(() => stopColors(tab)).toEqual(colors);
    } finally {
      await workspace.client.archiveAgent(workspace.agentId).catch(() => undefined);
      await workspace.cleanup();
      await seed.restore();
    }
  });
}
