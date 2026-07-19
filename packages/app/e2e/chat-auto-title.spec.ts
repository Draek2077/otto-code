import { test, expect } from "./fixtures";
import { openAgentRoute } from "./helpers/mock-agent";
import { seedWorkspace, type SeedDaemonClient } from "./helpers/seed-client";
import { patchMetadataGenerationProviders } from "./helpers/mock-scenarios";

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

// Chat auto-titling (AgentAutoTitle) runs the daemon's structured-generation
// ladder. These tests pin the metadata-generation provider chain to the mock
// provider so the "AI" title is deterministic: the mock answers the AgentTitle
// JSON prompt with the first three words of the chat's first prompt line.
// The suite runs with workers: 1; the pinned chain is restored in finally.
test.describe("Chat auto title", () => {
  test("replaces the provisional first-line title with the generated title", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "chat-auto-title-" });
    try {
      await patchMetadataGenerationProviders(workspace.client, [
        { provider: "mock", model: "ten-second-stream" },
      ]);

      const firstLine = "Ship the mock auto title generator";
      const firstLineWords = new Set(firstLine.toLowerCase().split(/\s+/).filter(Boolean));

      // No explicit title: the chat starts with the provisional first-line
      // title and the daemon schedules the AI title writer off the hot path.
      const created = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        modeId: "load-test",
        model: "ten-second-stream",
        initialPrompt: `${firstLine}\n\nKeep the deterministic mock path covered.`,
      });

      // The provisional first-line title is replaced by a short generated title.
      // The mock derives it deterministically from the prompt words, so assert
      // the shape (1–3 words, all drawn from the prompt, ≤ 40 chars) rather than
      // pinning which words the writer selects.
      let generatedTitle = "";
      await expect
        .poll(
          async () => {
            const title = await fetchAgentTitle(workspace.client, created.id);
            if (!title || title === firstLine) {
              return false;
            }
            generatedTitle = title;
            return true;
          },
          { timeout: 60_000 },
        )
        .toBe(true);

      const titleWords = generatedTitle.split(/\s+/).filter(Boolean);
      expect(titleWords.length).toBeGreaterThanOrEqual(1);
      expect(titleWords.length).toBeLessThanOrEqual(3);
      expect(generatedTitle.length).toBeLessThanOrEqual(40);
      for (const word of titleWords) {
        expect(firstLineWords).toContain(word.toLowerCase());
      }

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: created.id });
      await expect(page.getByTestId(`workspace-tab-agent_${created.id}`)).toContainText(
        generatedTitle,
        { timeout: 15_000 },
      );
    } finally {
      await patchMetadataGenerationProviders(workspace.client, []).catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("never overwrites an explicit caller-set title", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "chat-auto-title-explicit-" });
    try {
      // Same pinned writer as above: if auto-titling ran at all for this chat,
      // it would succeed and rename it — the explicit title must win instead.
      await patchMetadataGenerationProviders(workspace.client, [
        { provider: "mock", model: "ten-second-stream" },
      ]);

      const explicitTitle = "Pinned explicit chat title";
      const created = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: explicitTitle,
        modeId: "load-test",
        model: "ten-second-stream",
        initialPrompt: "Rename bait for the auto title writer\n\nThe explicit title must stay.",
      });

      // The initial turn finishing is a stable "auto-title settled" anchor: the
      // writer is scheduled at create time and resolves well before the mock's
      // ten-second stream completes.
      await workspace.client.waitForFinish(created.id, 60_000);
      expect(await fetchAgentTitle(workspace.client, created.id)).toBe(explicitTitle);

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: created.id });
      await expect(page.getByTestId(`workspace-tab-agent_${created.id}`)).toContainText(
        explicitTitle,
        { timeout: 15_000 },
      );
    } finally {
      await patchMetadataGenerationProviders(workspace.client, []).catch(() => undefined);
      await workspace.cleanup();
    }
  });
});
