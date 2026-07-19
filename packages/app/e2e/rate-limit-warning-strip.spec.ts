import { test, expect } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { buildRateLimitScenarioPrompt } from "./helpers/mock-scenarios";

const WARNING_STRIP = "composer-rate-limit-warning";

test.describe("Rate limit warning strip", () => {
  test("shows the warning strip on a rate_limit_updated event and clears it on recovery", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "rate-limit-strip-",
      title: "Rate limit warning strip",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      // Drive the event out of band so the composer state is purely event-fed.
      await agent.client.sendAgentMessage(agent.agentId, buildRateLimitScenarioPrompt("warning"));

      // Deterministic mock payload: warning, 85% used, five_hour window.
      const strip = page.getByTestId(WARNING_STRIP);
      await expect(strip).toBeVisible({ timeout: 30_000 });
      await expect(strip).toContainText("Approaching your Claude 5-hour limit");
      await expect(strip).toContainText("85% used");
      await agent.client.waitForFinish(agent.agentId, 30_000);

      // A "rejected" update swaps the copy to the hard-limit variant.
      await agent.client.sendAgentMessage(agent.agentId, buildRateLimitScenarioPrompt("rejected"));
      await expect(strip).toContainText("Claude 5-hour limit reached", { timeout: 30_000 });
      await agent.client.waitForFinish(agent.agentId, 30_000);

      // An "allowed" recovery event clears the strip entirely.
      await agent.client.sendAgentMessage(agent.agentId, buildRateLimitScenarioPrompt("allowed"));
      await expect(strip).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await agent.cleanup();
    }
  });

  test("stays hidden when the rateLimitWarningsEnabled setting is off", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "@otto:app-settings",
        JSON.stringify({ rateLimitWarningsEnabled: false }),
      );
    });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "rate-limit-strip-off-",
      title: "Rate limit warnings disabled",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      await agent.client.sendAgentMessage(agent.agentId, buildRateLimitScenarioPrompt("warning"));
      // The finished turn anchors "the event has definitely been delivered".
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expect(
        page.getByTestId("assistant-message").filter({ hasText: "Synthetic rate limit emitted." }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(WARNING_STRIP)).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
