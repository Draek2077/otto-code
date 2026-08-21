import { test, expect, type Page } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { composerLocator, expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { buildPromptSuggestionScenarioPrompt } from "../support/helpers/mock-scenarios";

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

  test("Escape cancels the running turn while preserving typed text", async ({ page }) => {
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

      // Escape never touches the composer text - typed-but-unsent text is unrecoverable.
      // A single Escape interrupts the running agent and leaves the draft intact.
      const input = composerLocator(page);
      await focusComposer(page);
      await input.fill("draft that should survive");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /stop|cancel/i })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(input).toHaveValue("draft that should survive");
    } finally {
      await agent.cleanup();
    }
  });
});
