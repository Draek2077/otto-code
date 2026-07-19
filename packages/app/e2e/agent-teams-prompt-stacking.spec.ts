import { expect, test } from "./fixtures";
import { seedWorkspace } from "./helpers/seed-client";
import {
  buildMockPersonality,
  buildTeam,
  connectPersonalitiesClient,
  readStoredAgentRecord,
  removePersonalitiesById,
  removeTeamsById,
  seedPersonalities,
  seedTeams,
  setActiveTeam,
  uniquePersonalityName,
} from "./helpers/personalities";

const TEAM_PROMPT = "E2E team frame: you are part of the stacking crew.";
const PERSONALITY_PROMPT = "E2E personality brief: you are the stacking specialist.";

// An agent spawned with a personality that belongs to the ACTIVE team must
// stack the team prompt directly ahead of the personality prompt. The composed
// prompt is not part of the client-facing agent snapshot, so the assertion
// surface is the daemon's persisted agent record
// ($OTTO_HOME/agents/<cwd-dir>/<agent-id>.json), which stores the composed
// config.systemPrompt plus the frozen personality/team snapshots.
test.describe("Agent teams prompt stacking", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an active-team member's spawn stacks team prompt before personality prompt", async ({
    page: _page,
  }) => {
    const client = await connectPersonalitiesClient();
    const personality = buildMockPersonality({
      name: uniquePersonalityName("E2eStack"),
      prompt: PERSONALITY_PROMPT,
    });
    const team = buildTeam({
      name: `E2E Stack Crew ${Date.now().toString(36)}`,
      memberIds: [personality.id],
      teamPrompt: TEAM_PROMPT,
    });
    let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;
    let agentId: string | null = null;

    try {
      await seedPersonalities(client, [personality]);
      await seedTeams(client, [team]);
      await setActiveTeam(client, team.id);

      workspace = await seedWorkspace({ repoPrefix: "team-prompt-stack-" });
      const agent = await client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Team prompt stacking e2e",
        modeId: "load-test",
        model: "ten-second-stream",
        personality: personality.id,
      });
      agentId = agent.id;
      expect(agent.personalityId).toBe(personality.id);
      expect(agent.personalityName).toBe(personality.name);

      const record = await readStoredAgentRecord(agent.id);
      const config = record.config;
      if (!config) {
        throw new Error("Stored agent record has no config section");
      }

      // The born team is frozen onto the agent.
      expect(config.teamSnapshot?.teamId).toBe(team.id);
      expect(config.teamSnapshot?.teamPrompt).toBe(TEAM_PROMPT);
      expect(config.personalitySnapshot?.personalityId).toBe(personality.id);

      // Stack order: team prompt first, personality prompt after it (a
      // role-focus directive may trail — assert order, not the full string).
      const systemPrompt = config.systemPrompt ?? "";
      expect(systemPrompt.startsWith(TEAM_PROMPT)).toBe(true);
      const teamIndex = systemPrompt.indexOf(TEAM_PROMPT);
      const personalityIndex = systemPrompt.indexOf(PERSONALITY_PROMPT);
      expect(teamIndex).toBe(0);
      expect(personalityIndex).toBeGreaterThan(teamIndex);
    } finally {
      if (agentId) {
        await client.archiveAgent(agentId).catch(() => undefined);
      }
      await setActiveTeam(client, null).catch(() => undefined);
      await removeTeamsById(client, [team.id]).catch(() => undefined);
      await removePersonalitiesById(client, [personality.id]).catch(() => undefined);
      await workspace?.cleanup().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
