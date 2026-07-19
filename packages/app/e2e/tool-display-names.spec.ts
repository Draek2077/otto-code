import { test, expect, type Page } from "./fixtures";
import { awaitToolCall } from "./helpers/agent-stream";
import { expectComposerVisible, submitMessage } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { buildNamedToolCallScenarioPrompt } from "./helpers/mock-scenarios";

// Action grouping (default on) reabsorbs completed tool calls into one
// collapsed row; these tests assert per-tool labels, so render every action as
// its own row (same seed as agent-stream-ui.spec.ts).
async function disableActionGrouping(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "@otto:app-settings",
      JSON.stringify({ groupConsecutiveActions: false }),
    );
  });
}

test.describe("Tool display names", () => {
  test("scripted stream tool calls render friendly labels, not raw tool ids", async ({ page }) => {
    test.setTimeout(120_000);
    await disableActionGrouping(page);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "tool-display-names-",
      title: "Tool display names",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await submitMessage(page, "Stream tool calls for the display-name test.");

      // The mock cycle emits raw tool names "read", "grep", "edit", "bash";
      // the rows must show the curated display names instead.
      await awaitToolCall(page, "Read");
      await awaitToolCall(page, "Search");
      await awaitToolCall(page, "Edit");
      await awaitToolCall(page, "Shell");

      // No badge leaks the raw lowercase tool ids ("bash"/"grep" appear nowhere
      // in the friendly labels or their summaries).
      const badges = page.getByTestId("tool-call-badge");
      await expect(badges.filter({ hasText: "bash" })).toHaveCount(0);
      await expect(badges.filter({ hasText: "grep" })).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("namespaced tool ids are humanized through the display-name fallback", async ({ page }) => {
    test.setTimeout(120_000);
    await disableActionGrouping(page);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "tool-display-humanize-",
      title: "Tool display humanizer",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      // An `unknown`-detail tool call falls through to getToolDisplayName's
      // humanizer: namespace stripped, snake_case title-cased.
      await submitMessage(page, buildNamedToolCallScenarioPrompt("mcp__otto__spawn_task"));
      await awaitToolCall(page, "Spawn Task");

      const badges = page.getByTestId("tool-call-badge");
      await expect(badges.filter({ hasText: "mcp__otto__spawn_task" })).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
