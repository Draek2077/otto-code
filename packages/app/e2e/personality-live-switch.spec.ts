import { expect, test } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  buildMockPersonality,
  connectPersonalitiesClient,
  expectModelTriggerShowsPersonality,
  MOCK_MODEL_ID,
  MOCK_MODEL_LABEL,
  modelPickerTrigger,
  removePersonalitiesById,
  seedPersonalities,
  uniquePersonalityName,
  waitForAgentSnapshot,
} from "./helpers/personalities";

// Live-switches a RUNNING mock agent's personality through the daemon's
// agent.personality.set RPC (DaemonClient.setAgentPersonality) and asserts the
// UI reflects the switch: the running agent's model/personality trigger shows
// the personality identity, and clearing it reverts to the raw model label.
test.describe("Running-agent personality switch", () => {
  test.describe.configure({ timeout: 180_000 });

  test("agent.personality.set applies and clears a personality on a running mock agent", async ({
    page,
  }) => {
    const client = await connectPersonalitiesClient();
    const personality = buildMockPersonality({
      name: uniquePersonalityName("E2eLive"),
      prompt: "You are the live-switch e2e personality.",
    });
    let session: Awaited<ReturnType<typeof seedMockAgentWorkspace>> | null = null;

    try {
      await seedPersonalities(client, [personality]);
      session = await seedMockAgentWorkspace({
        repoPrefix: "personality-switch-",
        title: "Personality switch e2e",
      });

      await openAgentRoute(page, session);
      await expectComposerVisible(page);

      // Start a turn so the agent is genuinely RUNNING (ten-second-stream)
      // when the switch lands.
      await session.client.sendAgentMessage(session.agentId, "Live switch e2e stream");
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
        timeout: 30_000,
      });

      // Switch via the RPC — the daemon re-resolves the roster id against the
      // agent's cwd, applies prompt + brain, and broadcasts the new state.
      await client.setAgentPersonality(session.agentId, personality.id);

      const bound = await waitForAgentSnapshot(
        client,
        session.agentId,
        (snapshot) => snapshot.personalityId === personality.id,
      );
      expect(bound.personalityName).toBe(personality.name);
      expect(bound.model).toBe(MOCK_MODEL_ID);

      // UI reflects the switch: the trigger shows the personality identity.
      await expectModelTriggerShowsPersonality(page, personality.name);

      // Clearing keeps the brain but drops the identity; the trigger reverts
      // to the raw model label.
      await client.setAgentPersonality(session.agentId, null);
      await waitForAgentSnapshot(
        client,
        session.agentId,
        (snapshot) => snapshot.personalityId === undefined,
      );
      const trigger = modelPickerTrigger(page);
      await expect(trigger).toContainText(MOCK_MODEL_LABEL, { timeout: 30_000 });
      await expect(trigger).not.toContainText(personality.name);
    } finally {
      await removePersonalitiesById(client, [personality.id]).catch(() => undefined);
      await session?.cleanup().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
