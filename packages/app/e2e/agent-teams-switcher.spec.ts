import { expect, test, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { openSettingsHostSection } from "./helpers/settings";
import { getServerId } from "./helpers/server-id";
import {
  buildMockPersonality,
  buildTeam,
  connectPersonalitiesClient,
  findTeamByName,
  getActiveTeamId,
  removePersonalitiesById,
  removeTeamsById,
  removeTeamsByName,
  seedPersonalities,
  seedTeams,
  setActiveTeam,
  uniquePersonalityName,
  type PersonalitiesDaemonClient,
} from "./helpers/personalities";

function switcherTrigger(page: Page) {
  return page
    .getByTestId(`active-team-switcher-${getServerId()}`)
    .filter({ visible: true })
    .first();
}

// Selecting inside the switcher's Combobox (desktop popover) by option label.
async function selectTeamInSwitcher(page: Page, optionLabel: string): Promise<void> {
  await switcherTrigger(page).click();
  const option = page
    .getByTestId("combobox-desktop-container")
    .getByText(optionLabel, { exact: true })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible({
    timeout: 10_000,
  });
}

async function expectActiveTeamId(
  client: PersonalitiesDaemonClient,
  teamId: string | null,
): Promise<void> {
  await expect.poll(async () => getActiveTeamId(client), { timeout: 30_000 }).toBe(teamId);
}

test.describe("Agent teams switcher", () => {
  test.describe.configure({ timeout: 240_000 });

  test("create a team, set it active, switch teams, and clear the active team", async ({
    page,
  }) => {
    const serverId = getServerId();
    const client = await connectPersonalitiesClient();
    const memberA = buildMockPersonality({ name: uniquePersonalityName("E2eTmA") });
    const memberB = buildMockPersonality({ name: uniquePersonalityName("E2eTmB") });
    const suffix = Date.now().toString(36);
    const teamAName = `E2E Crew A ${suffix}`;
    const teamB = buildTeam({
      name: `E2E Crew B ${suffix}`,
      memberIds: [memberB.id],
      teamPrompt: "Crew B works together.",
    });
    let teamAId: string | null = null;

    try {
      await seedPersonalities(client, [memberA, memberB]);
      await seedTeams(client, [teamB]);
      // Precondition the host on "no active team" so the switcher's initial
      // label is deterministic regardless of what ran before.
      await setActiveTeam(client, null);

      // ── Create team A through the settings editor ───────────────────────
      await gotoAppShell(page);
      await openSettings(page);
      await openSettingsHostSection(page, serverId, "agents");
      await expect(page.getByTestId("agent-teams-section")).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("agent-teams-add-button").click();
      const modal = page.getByTestId("agent-team-edit-modal");
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("agent-team-name-input").fill(teamAName);
      await page.getByTestId(`agent-team-member-${memberA.id}`).click();
      await page.getByTestId("agent-team-save-button").click();
      await expect(modal).not.toBeVisible({ timeout: 30_000 });

      await expect
        .poll(async () => (await findTeamByName(client, teamAName)) !== null, { timeout: 30_000 })
        .toBe(true);
      const teamA = await findTeamByName(client, teamAName);
      if (!teamA) {
        throw new Error(`Team "${teamAName}" not found in daemon config after save`);
      }
      teamAId = teamA.id;
      expect(teamA.memberIds).toEqual([memberA.id]);
      await expect(page.getByTestId(`agent-team-row-${teamA.id}`)).toBeVisible({
        timeout: 30_000,
      });

      // ── Switch teams from the sidebar switcher ──────────────────────────
      await gotoAppShell(page);
      const trigger = switcherTrigger(page);
      await expect(trigger).toBeVisible({ timeout: 30_000 });
      await expect(trigger).toContainText("No active team");

      await selectTeamInSwitcher(page, teamAName);
      await expect(trigger).toContainText(teamAName, { timeout: 30_000 });
      await expectActiveTeamId(client, teamA.id);

      await selectTeamInSwitcher(page, teamB.name);
      await expect(trigger).toContainText(teamB.name, { timeout: 30_000 });
      await expect(trigger).not.toContainText(teamAName);
      await expectActiveTeamId(client, teamB.id);

      // ── The settings list marks exactly the active team ─────────────────
      await openSettings(page);
      await openSettingsHostSection(page, serverId, "agents");
      await expect(page.getByTestId(`agent-team-active-badge-${teamB.id}`)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId(`agent-team-active-badge-${teamA.id}`)).toHaveCount(0);

      // ── Clear back to no active team ────────────────────────────────────
      await gotoAppShell(page);
      await selectTeamInSwitcher(page, "No active team");
      await expect(switcherTrigger(page)).toContainText("No active team", { timeout: 30_000 });
      await expectActiveTeamId(client, null);
    } finally {
      await setActiveTeam(client, null).catch(() => undefined);
      await removeTeamsById(client, [teamAId ?? "", teamB.id].filter(Boolean)).catch(
        () => undefined,
      );
      // Safety net for a UI save that landed under a different id than we read.
      await removeTeamsByName(client, [teamAName, teamB.name]).catch(() => undefined);
      await removePersonalitiesById(client, [memberA.id, memberB.id]).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
