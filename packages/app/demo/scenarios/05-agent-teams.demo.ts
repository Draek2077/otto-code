import { expect, test } from "../../e2e/fixtures";
import { gotoAppShell } from "../../e2e/helpers/app";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import { openModelPersonalityPicker, removeTeamsByName } from "../../e2e/helpers/personalities";
import { getServerId } from "../../e2e/helpers/server-id";
import { buildSettingsHostSectionRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, humanType, resetPacingSeed } from "../helpers/pacing";
import { seedDemoCast, waitForProvidersReady, type DemoCast } from "../staging/cast";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 05 — Agent teams (one feature: creating a team and what an active
 * team changes). The Research Guild is pre-seeded so the teams list is never
 * empty; the Ship Crew is created on camera — that's the tutorial beat. The
 * payoff is the composer picker leading with the active team's role slots.
 */

const SHIP_CREW_NAME = "Ship Crew";

let workspace: DemoWorkspace;
let storefront: DemoWorkspace;
let cast: DemoCast;

test.beforeAll(async () => {
  // Both staged repos, so the sidebar reads lived-in (whole-frame rule).
  storefront = await seedDemoWorkspace({
    template: "mango-storefront",
    originOwner: "mango-labs",
    title: "Storefront search",
  });
  workspace = await seedDemoWorkspace({
    template: "pulse-api",
    originOwner: "pulse-labs",
    title: "Rate limiting",
  });
  cast = await seedDemoCast({ teams: ["researchGuild"] });
});

test.afterAll(async () => {
  // The Ship Crew was created through the UI, so it isn't in the cast's
  // cleanup set — remove it by name before the cast tears down its members.
  await removeTeamsByName(cast.client, [SHIP_CREW_NAME]).catch(() => undefined);
  await cast?.cleanup();
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("agent teams walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `05-agent-teams-${theme}`);
  const serverId = getServerId();

  // ── The teams list in host settings ───────────────────────────────────────
  // Teams/personalities/voices moved to their own "teams" settings section
  // (split out of the Agents page — see host-page.tsx's HostTeamsPage).
  await page.goto(buildSettingsHostSectionRoute(serverId, "teams"));
  await expect(page.getByTestId("agent-teams-section")).toBeVisible({ timeout: 30_000 });
  await waitForProvidersReady(page);
  await page.getByTestId("agent-teams-section").scrollIntoViewIfNeeded();
  await beat(page);
  await recorder.shot(
    "teams",
    "Teams: personalities that work together",
    "A team is a named lineup of personalities with a shared prompt — switch teams and the whole host follows.",
  );

  // ── Create the Ship Crew on camera ────────────────────────────────────────
  await humanClick(page, page.getByTestId("agent-teams-add-button"));
  const modal = page.getByTestId("agent-team-edit-modal");
  await expect(modal).toBeVisible({ timeout: 15_000 });
  // Fill the form completely, top to bottom — name, shared prompt, members.
  await humanType(page, page.getByTestId("agent-team-name-input"), SHIP_CREW_NAME);
  await humanType(
    page,
    page.getByTestId("agent-team-prompt-input"),
    "Bias to action: plan tight, build small, review honestly, and keep main green.",
  );
  for (const member of ["aria", "forge", "sage", "tempo"] as const) {
    await humanClick(page, page.getByTestId(`agent-team-member-${cast.personalities[member].id}`));
  }
  await beat(page);
  await recorder.shot(
    "team-editor",
    "Build the lineup",
    "Name the team and tick its members — each brings their own model, roles, and prompt.",
  );

  await humanClick(page, page.getByTestId("agent-team-save-button"));
  await expect(modal).not.toBeVisible({ timeout: 30_000 });
  await beat(page);
  await recorder.shot(
    "teams-saved",
    "The crew is ready",
    "Ship Crew joins the roster next to the Research Guild.",
  );

  // ── Activate it from the sidebar switcher ─────────────────────────────────
  await gotoAppShell(page);
  const switcher = page
    .getByTestId(`active-team-switcher-${serverId}`)
    .filter({ visible: true })
    .first();
  await expect(switcher).toBeVisible({ timeout: 30_000 });
  await humanClick(page, switcher);
  await expect(page.getByTestId("combobox-desktop-container")).toBeVisible({ timeout: 15_000 });
  await beat(page);
  await recorder.shot(
    "team-switcher",
    "One switcher, instant handoff",
    "The active team lives in the sidebar — swap crews without touching any agent.",
  );

  await humanClick(
    page,
    page.getByTestId("combobox-desktop-container").getByText(SHIP_CREW_NAME, { exact: true }),
  );
  await expect(switcher).toContainText(SHIP_CREW_NAME, { timeout: 30_000 });
  await beat(page);
  await recorder.shot(
    "team-active",
    "Ship Crew is on duty",
    "New chats, schedules, and artifacts now draft from this team first.",
  );

  // ── The payoff: the picker leads with the team ────────────────────────────
  await gotoWorkspace(page, workspace.workspaceId);
  await openModelPersonalityPicker(page);
  await beat(page);
  await recorder.shot(
    "picker-team",
    "Team roles in every picker",
    "With a team active, pickers lead with its section — including role slots that always resolve to the crew's current holder.",
  );

  await humanClick(page, page.getByTestId("personality-group-team").first());
  await beat(page);
  await recorder.shot(
    "picker-team-roles",
    "Meet the crew",
    "Aria, Forge, Argus, and Tempo — pick a member, or a role slot that follows the team.",
  );

  await recorder.finish(testInfo);
});
