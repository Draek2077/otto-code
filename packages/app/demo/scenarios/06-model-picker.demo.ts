import { expect, test } from "../../e2e/fixtures";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import {
  openModelPersonalityPicker,
  selectPersonalityInPicker,
} from "../../e2e/helpers/personalities";
import { buildArtifactsRoute, buildSchedulesRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, humanType, resetPacingSeed } from "../helpers/pacing";
import { seedDemoCast, type DemoCast } from "../staging/cast";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 06 — The combined model/personality picker (one feature: the same
 * picker on every surface, role-aware). Chats, schedules, and artifacts all
 * render the identical CombinedModelSelector; the cast's uneven roles make
 * the filtering visible — schedules put Tempo (scheduler) up front, artifacts
 * Muse (artificer), chat the chatter subset. No team is active: with one, the
 * picker strictly scopes to team members (that story is scenario 05) and the
 * cross-team role spread here would vanish.
 *
 * Forms are filled completely, top to bottom, before they're photographed —
 * a tutorial screenshot shows the software being used properly, never a
 * placeholder state.
 */

let workspace: DemoWorkspace;
let pulse: DemoWorkspace;
let cast: DemoCast;

test.beforeAll(async () => {
  // Both staged repos, so the sidebar reads lived-in (whole-frame rule).
  workspace = await seedDemoWorkspace({
    template: "mango-storefront",
    originOwner: "mango-labs",
    title: "Storefront search",
  });
  pulse = await seedDemoWorkspace({
    template: "pulse-api",
    originOwner: "pulse-labs",
    title: "Rate limiting",
  });
  cast = await seedDemoCast();
});

test.afterAll(async () => {
  await cast?.cleanup();
  await pulse?.cleanup();
  await workspace?.cleanup();
});

test("model picker across surfaces", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `06-model-picker-${theme}`);

  const closePicker = async () => {
    await page.keyboard.press("Escape");
    await beat(page);
  };
  // SelectField options open in the desktop combobox popover.
  const selectComboOption = async (label: string) => {
    const option = page
      .getByTestId("combobox-desktop-container")
      .getByText(label, { exact: false })
      .first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await humanClick(page, option);
    await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible({
      timeout: 10_000,
    });
  };

  // ── Chat composer ─────────────────────────────────────────────────────────
  await gotoWorkspace(page, workspace.workspaceId);
  await openModelPersonalityPicker(page);
  await beat(page);
  await recorder.shot(
    "chat-picker",
    "One picker for chats",
    "Providers, models, and personalities in one place — chat surfaces lead with the conversational cast.",
  );
  await closePicker();

  // ── Schedule form, filled top to bottom ───────────────────────────────────
  // An empty list renders schedules-empty-new instead of the toolbar button.
  await page.goto(buildSchedulesRoute());
  await humanClick(
    page,
    page.getByTestId("schedules-new").or(page.getByTestId("schedules-empty-new")).first(),
  );
  const scheduleSheet = page.getByTestId("schedule-form-sheet");
  await expect(scheduleSheet).toBeVisible({ timeout: 30_000 });

  await humanType(page, page.getByTestId("schedule-name-input"), "Nightly test sweep");
  await humanType(
    page,
    page.getByTestId("schedule-prompt-input"),
    "Run the test suite and summarize any failures with their likely causes.",
  );
  await humanClick(page, page.getByTestId("schedule-project-trigger"));
  await selectComboOption(workspace.projectDisplayName);
  await beat(page);

  await humanClick(page, scheduleSheet.getByTestId("combined-model-selector").first());
  await beat(page);
  await recorder.shot(
    "schedule-picker",
    "Role-aware: schedulers only",
    "Personalities are filtered by role here — the schedulers, Tempo and Dash, step forward.",
  );

  await selectPersonalityInPicker(page, cast.personalities.tempo.id);
  await beat(page);
  await recorder.shot(
    "schedule-form",
    "A schedule run by Tempo",
    "Name, prompt, project, and the personality that runs it — the same picker chats use.",
  );
  await page.keyboard.press("Escape"); // close the form sheet without saving
  await beat(page);

  // ── Artifact form, filled top to bottom ───────────────────────────────────
  // Same empty-state split as schedules.
  await page.goto(buildArtifactsRoute());
  await humanClick(
    page,
    page.getByTestId("artifacts-new").or(page.getByTestId("artifacts-empty-new")).first(),
  );
  const artifactSheet = page.getByTestId("artifact-create-sheet");
  await expect(artifactSheet).toBeVisible({ timeout: 30_000 });

  await humanType(page, page.getByTestId("artifact-name-input"), "Conversion dashboard");
  await humanType(
    page,
    page.getByTestId("artifact-description-input"),
    "A one-page dashboard of storefront conversion metrics with mock data and dark styling.",
  );
  // The sheet's model catalog resolves from the selected project's host —
  // without a project it renders "No models match your search".
  await humanClick(page, page.getByTestId("artifact-project-trigger"));
  await selectComboOption(workspace.projectDisplayName);
  await beat(page);

  await humanClick(page, artifactSheet.getByTestId("combined-model-selector").first());
  await beat(page);
  await recorder.shot(
    "artifact-picker",
    "Role-aware: artificers only",
    "The artificers — Muse and Pixel — are offered here; same picker, different role filter.",
  );

  await selectPersonalityInPicker(page, cast.personalities.muse.id);
  await beat(page);
  await recorder.shot(
    "artifact-form",
    "An artifact authored by Muse",
    "Name, prompt, project, and the artificer who'll build it — ready to generate.",
  );

  await recorder.finish(testInfo);
});
