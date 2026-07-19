import { expect, test } from "./fixtures";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";
import {
  asLocalAiFlowClient,
  fetchTimelineItems,
  waitForTimelineItem,
} from "./helpers/local-ai-flows";

/**
 * Tier-2: proves manual compaction on the daemon-owned openai-compat session.
 * "/compact" is intercepted by the provider before the model sees it
 * (openai-compat-agent.ts executeTurn → handleCompact("manual")) and emits a
 * durable `compaction` timeline item (loading → completed), rendered in the
 * chat as the compaction marker. The spec drives two short turns, compacts,
 * then proves the session still accepts and completes a follow-up turn.
 * Asserts on daemon-emitted timeline structure — never on model prose.
 */

const FIRST_PROMPT = "Reply with exactly the word ready and nothing else. Do not use any tools.";
const SECOND_PROMPT = "Reply with exactly the word again and nothing else. Do not use any tools.";
const FOLLOW_UP_PROMPT = "Reply with exactly the word done and nothing else. Do not use any tools.";

test.describe("openai-compat manual compaction", () => {
  test.setTimeout(600_000);

  test("/compact emits a compaction marker and the session keeps working", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-compaction",
      title: "Local AI compaction",
      modeId: "bypassPermissions",
      initialPrompt: FIRST_PROMPT,
    });
    try {
      const { agentId, workspace } = seeded;
      const client = asLocalAiFlowClient(workspace.client);

      // Turn 1 (initial prompt). The assistant-message wait also covers the
      // race where waitForFinish lands before the initial turn registers.
      const finishedFirst = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedFirst.status).toBe("idle");
      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) => item.type === "assistant_message",
        label: "assistant reply to the first turn",
        timeoutMs: LOCAL_AI_TURN_TIMEOUT_MS,
      });

      // Turn 2: a second short exchange so compaction has real history.
      await client.sendAgentMessage(agentId, SECOND_PROMPT);
      const finishedSecond = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedSecond.status).toBe("idle");

      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));

      // Manual compaction. The provider completes the turn without a model
      // round-trip (a no-op compaction still reports "completed").
      await client.sendAgentMessage(agentId, "/compact");
      const finishedCompact = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedCompact.status).toBe("idle");

      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) =>
          item.type === "compaction" &&
          item["status"] === "completed" &&
          item["trigger"] === "manual",
        label: "completed manual compaction item",
      });
      await expect(page.getByTestId("compaction-marker").first()).toBeVisible({ timeout: 30_000 });

      // The compacted session still accepts and completes a follow-up turn.
      await client.sendAgentMessage(agentId, FOLLOW_UP_PROMPT);
      const finishedFollowUp = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finishedFollowUp.status).toBe("idle");
      expect(finishedFollowUp.final?.lastError ?? null).toBeNull();

      // Structural proof on the durable timeline: the follow-up user message
      // sits after the compaction item and got an assistant reply after it.
      const items = await fetchTimelineItems(client, agentId);
      const compactionIndex = items.findIndex(
        (item) => item.type === "compaction" && item["status"] === "completed",
      );
      expect(compactionIndex).toBeGreaterThanOrEqual(0);
      const followUpIndex = items.findIndex(
        (item) => item.type === "user_message" && item["text"] === FOLLOW_UP_PROMPT,
      );
      expect(followUpIndex).toBeGreaterThan(compactionIndex);
      const hasReplyAfterFollowUp = items
        .slice(followUpIndex + 1)
        .some((item) => item.type === "assistant_message");
      expect(hasReplyAfterFollowUp).toBe(true);
    } finally {
      await seeded.cleanup();
    }
  });
});
