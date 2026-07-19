import { test, expect, type Page } from "./fixtures";
import { awaitAssistantMessage } from "./helpers/agent-stream";
import { composerLocator, expectComposerVisible, submitMessage } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { buildPromptSuggestionScenarioPrompt } from "./helpers/mock-scenarios";

// The two-line assistant-markdown scenario completes its turn instantly, so
// history entries accumulate without waiting out the mock's streamed cycle.
const RECALL_PROMPT_ONE = "emit synthetic assistant markdown\nHistory recall entry one.";
const RECALL_PROMPT_TWO = "emit synthetic assistant markdown\nHistory recall entry two.";

async function focusComposer(page: Page): Promise<void> {
  const input = composerLocator(page);
  await expect(input).toBeEditable({ timeout: 30_000 });
  await input.click();
}

test.describe("Composer suggestions and history", () => {
  test("ArrowUp recalls sent messages and ArrowDown walks forward to the draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "composer-history-",
      title: "Composer history recall",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      await submitMessage(page, RECALL_PROMPT_ONE);
      await awaitAssistantMessage(page, "History recall entry one.");
      await submitMessage(page, RECALL_PROMPT_TWO);
      await awaitAssistantMessage(page, "History recall entry two.");

      const input = composerLocator(page);
      await focusComposer(page);
      await expect(input).toHaveValue("");

      // Shell-history semantics: Up walks newest -> oldest.
      await input.press("ArrowUp");
      await expect(input).toHaveValue(RECALL_PROMPT_TWO);
      await input.press("ArrowUp");
      await expect(input).toHaveValue(RECALL_PROMPT_ONE);

      // Down walks forward again and finally restores the (empty) live draft.
      await input.press("ArrowDown");
      await expect(input).toHaveValue(RECALL_PROMPT_TWO);
      await input.press("ArrowDown");
      await expect(input).toHaveValue("");
    } finally {
      await agent.cleanup();
    }
  });

  test("ghost-text prompt suggestion renders as placeholder and Tab accepts it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suggestion = "Review the failing spec next";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "composer-suggestion-",
      title: "Composer ghost suggestion",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      await submitMessage(page, buildPromptSuggestionScenarioPrompt(suggestion));

      // The suggestion arrives on the agent stream after the turn starts and is
      // rendered as the input's placeholder (ghost text) while the box is empty.
      const input = composerLocator(page);
      await expect(input).toHaveAttribute("placeholder", suggestion, { timeout: 30_000 });
      await expect(input).toHaveValue("");

      // Tab accepts the ghost text into the draft and clears the suggestion.
      await focusComposer(page);
      await input.press("Tab");
      await expect(input).toHaveValue(suggestion);
      await expect(input).not.toHaveAttribute("placeholder", suggestion);
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape clears typed text first, then a second Escape cancels the running turn", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // A long-running model removes ambiguity between "turn was canceled" and
    // "turn just finished on its own" when asserting the stop button vanishes.
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "composer-escape-",
      title: "Composer escape behavior",
      model: "one-minute-stream",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      await submitMessage(page, "Stream for escape-cancel test.");
      const stopButton = page.getByRole("button", { name: /stop|cancel/i }).first();
      await expect(stopButton).toBeVisible({ timeout: 30_000 });

      // First Escape with text in the box only clears the draft.
      const input = composerLocator(page);
      await focusComposer(page);
      await input.fill("draft that should be cleared");
      await page.keyboard.press("Escape");
      await expect(input).toHaveValue("");
      await expect(stopButton).toBeVisible();

      // Second Escape with an empty box interrupts the running agent.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /stop|cancel/i })).toHaveCount(0, {
        timeout: 15_000,
      });
    } finally {
      await agent.cleanup();
    }
  });
});
