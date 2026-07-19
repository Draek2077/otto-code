import { expect, test, type Page } from "./fixtures";
import { expectComposerVisible, submitMessage } from "./helpers/composer";
import { clickNewChat, gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace } from "./helpers/seed-client";
import {
  buildMockPersonality,
  connectPersonalitiesClient,
  expectModelTriggerShowsPersonality,
  MOCK_MODEL_ID,
  MOCK_MODE_ID,
  MOCK_PROVIDER_ID,
  openModelPersonalityPicker,
  removePersonalitiesById,
  seedPersonalities,
  selectPersonalityInPicker,
  uniquePersonalityName,
  waitForAgentInWorkspace,
  waitForAgentSnapshot,
} from "./helpers/personalities";

// A fresh workspace may open on a launcher tile instead of an open draft tab;
// normalize to an editable draft composer either way.
async function openDraftComposer(page: Page): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
  if (!(await composer.isVisible().catch(() => false))) {
    await clickNewChat(page);
  }
  await expectComposerVisible(page);
}

test.describe("Personality on new chat", () => {
  test.describe.configure({ timeout: 180_000 });

  test("selecting a personality in the draft picker binds it to the created agent", async ({
    page,
  }) => {
    const client = await connectPersonalitiesClient();
    const personality = buildMockPersonality({
      name: uniquePersonalityName("E2eApply"),
      prompt: "You are the new-chat apply e2e personality.",
    });
    let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

    try {
      await seedPersonalities(client, [personality]);
      workspace = await seedWorkspace({ repoPrefix: "personality-apply-" });

      await gotoWorkspace(page, workspace.workspaceId);
      await openDraftComposer(page);

      // Pick the personality from the combined model/personality picker; the
      // trigger label switches from the model label to the personality name.
      await openModelPersonalityPicker(page);
      await selectPersonalityInPicker(page, personality.id);
      await expectModelTriggerShowsPersonality(page, personality.name);

      await submitMessage(page, "Personality apply e2e");

      // Daemon truth: the created agent carries the personality identity and
      // its bound brain (provider/model/mode).
      const created = await waitForAgentInWorkspace(client, workspace.workspaceId);
      const agent = await waitForAgentSnapshot(
        client,
        created.id,
        (snapshot) => snapshot.personalityId === personality.id,
      );
      expect(agent.provider).toBe(MOCK_PROVIDER_ID);
      expect(agent.model).toBe(MOCK_MODEL_ID);
      expect(agent.currentModeId).toBe(MOCK_MODE_ID);
      expect(agent.personalityName).toBe(personality.name);
      expect(agent.personalitySpinner).toEqual(personality.spinner);

      // UI truth: the running agent's controls keep showing the personality
      // identity instead of reverting to the raw model label.
      await expectModelTriggerShowsPersonality(page, personality.name);
    } finally {
      await removePersonalitiesById(client, [personality.id]).catch(() => undefined);
      await workspace?.cleanup().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
