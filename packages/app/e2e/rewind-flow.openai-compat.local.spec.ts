import { expect, test, type Page } from "./fixtures";
import { expectComposerEditable, submitMessage } from "./helpers/composer";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";
import {
  asLocalAiFlowClient,
  fetchTimelineEpoch,
  fetchTimelineItems,
} from "./helpers/local-ai-flows";

/**
 * Tier-2: rewind against the local model. The shared rewind-flow helper is
 * typed to the CLI providers (its launch config has no openai-compatible
 * branch), so this is a minimal local variant following the same shape. The
 * openai-compat provider only supports conversation rewind
 * (supportsRewindConversation, no files/both — see CAPABILITIES in
 * openai-compat-agent.ts), so the flow is: one chat turn, rewind it away,
 * prove the transcript and durable timeline are empty, then prove the session
 * still completes a fresh turn. Asserts on row counts and timeline structure —
 * never on model prose.
 */

const FIRST_PROMPT = "Reply with exactly the word pong and nothing else. Do not use any tools.";
const SECOND_PROMPT = "Reply with exactly the word ping and nothing else. Do not use any tools.";

function chatScroll(page: Page) {
  return page.locator('[data-testid="agent-chat-scroll"]:visible').first();
}

function userMessages(page: Page) {
  return chatScroll(page).getByTestId("user-message");
}

function assistantMessages(page: Page) {
  return chatScroll(page).getByTestId("assistant-message");
}

test.describe("rewind flow - openai-compatible (local AI)", () => {
  test.setTimeout(600_000);

  test("rewinds the conversation and the session keeps working", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-rewind",
      title: "Local AI rewind",
      modeId: "bypassPermissions",
    });
    try {
      const { agentId, workspace } = seeded;
      const client = asLocalAiFlowClient(workspace.client);

      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
      await expectComposerEditable(page);

      // Turn 1 through the composer, like a user.
      await submitMessage(page, FIRST_PROMPT);
      const finishedFirst = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedFirst.status).toBe("idle");
      await expect(userMessages(page)).toHaveCount(1, { timeout: 30_000 });
      await expect(assistantMessages(page).first()).toBeVisible({ timeout: 30_000 });

      // Rewind the conversation from the user message's hover menu.
      const beforeEpoch = await fetchTimelineEpoch(client, agentId);
      const userMessage = userMessages(page).first();
      await userMessage.hover();
      const trigger = userMessage.getByTestId("rewind-menu-trigger");
      await expect(trigger).toBeVisible({ timeout: 10_000 });
      await trigger.click();
      await expect(page.getByTestId("rewind-menu-content")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("rewind-menu-conversation").click();
      await expect(page.getByTestId("rewind-menu-content")).toHaveCount(0, { timeout: 10_000 });

      // The daemon rebuilt the timeline (new epoch) and the transcript is empty.
      await expect
        .poll(() => fetchTimelineEpoch(client, agentId), { timeout: 120_000 })
        .not.toBe(beforeEpoch);
      await expect(userMessages(page)).toHaveCount(0, { timeout: 30_000 });
      const itemsAfterRewind = await fetchTimelineItems(client, agentId);
      expect(itemsAfterRewind.filter((item) => item.type === "user_message")).toHaveLength(0);

      // The rewound session still accepts and completes a fresh turn.
      await expectComposerEditable(page);
      await submitMessage(page, SECOND_PROMPT);
      const finishedSecond = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedSecond.status).toBe("idle");
      await expect(userMessages(page)).toHaveCount(1, { timeout: 30_000 });
      await expect(assistantMessages(page).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await seeded.cleanup();
    }
  });
});
