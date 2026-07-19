import { expect, test } from "../../e2e/fixtures";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import {
  modelPickerTrigger,
  openModelPersonalityPicker,
  selectPersonalityInPicker,
} from "../../e2e/helpers/personalities";
import { getServerId } from "../../e2e/helpers/server-id";
import { buildSettingsHostSectionRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, resetPacingSeed } from "../helpers/pacing";
import { seedDemoCast, waitForProvidersReady, type DemoCast } from "../staging/cast";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 04 — Agent personalities (one feature: browsing and shaping a
 * personality). No agent run: the seeded cast makes the roster, editor, and
 * composer picker photogenic on their own. Steps walk the discovery path a
 * user takes: settings roster → tabbed editor → the payoff in the composer's
 * picker.
 */

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
  // Personalities only — teams get their own scenario (05).
  cast = await seedDemoCast({ teams: [] });
});

test.afterAll(async () => {
  await cast?.cleanup();
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("personalities walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `04-personalities-${theme}`);

  // ── The roster in host settings ───────────────────────────────────────────
  // Personalities/teams/voices live on their own "teams" settings section (split
  // out of the Agents page — see host-page.tsx's HostTeamsPage), not "agents".
  await page.goto(buildSettingsHostSectionRoute(getServerId(), "teams"));
  await expect(page.getByTestId("agent-personalities-section")).toBeVisible({ timeout: 30_000 });
  await waitForProvidersReady(page);
  await page.getByTestId("agent-personalities-card").scrollIntoViewIfNeeded();
  await beat(page);
  await recorder.shot(
    "roster",
    "Your agent personalities",
    "Named agent templates — each with its own model, role, colors, and voice — live in host settings.",
  );

  // ── The tabbed editor, one tab per facet ──────────────────────────────────
  const ariaRow = page
    .getByTestId("agent-personalities-card")
    .locator('[data-testid^="agent-personality-row-"]')
    .filter({ hasText: cast.personalities.aria.name })
    .first();
  await expect(ariaRow).toBeVisible({ timeout: 30_000 });
  await humanClick(page, ariaRow.locator('[data-testid^="agent-personality-edit-"]'));
  const modal = page.getByTestId("agent-personality-edit-modal");
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await beat(page);
  await recorder.shot(
    "editor-identity",
    "Identity: name, roles, colors",
    "A personality declares which roles it can fill — orchestrator, coder, reviewer — and the colors it glows with.",
  );

  const switchTab = async (label: string) => {
    await humanClick(
      page,
      page.getByTestId("agent-personality-tabs").getByRole("button", { name: label, exact: true }),
    );
    await beat(page);
  };

  await switchTab("Personality");
  await recorder.shot(
    "editor-prompt",
    "Personality: the system prompt",
    "The prompt that shapes how this agent thinks and talks, layered on top of your global instructions.",
  );

  await switchTab("Model");
  await recorder.shot(
    "editor-model",
    "Model: provider binding",
    "Each personality picks its own provider and model — frontier cloud or local, per personality.",
  );

  await switchTab("Voice");
  await recorder.shot(
    "editor-voice",
    "Voice: spoken cue lines",
    "Optional voice cues the personality speaks when it joins, thinks, and finishes.",
  );

  // Nothing was edited, so Escape closes cleanly without a discard prompt.
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible({ timeout: 15_000 });

  // ── The payoff: picking a personality in the composer ─────────────────────
  await gotoWorkspace(page, workspace.workspaceId);
  await openModelPersonalityPicker(page);
  await beat(page);
  await recorder.shot(
    "picker",
    "Personalities in the model picker",
    "The composer's picker lists your personalities right beside raw models.",
  );

  // With no active team the roster shows as the single "All personalities"
  // group; drill in to show the cast.
  await humanClick(page, page.getByTestId("personality-group-all").first());
  await beat(page);
  await recorder.shot(
    "picker-cast",
    "Browse the cast",
    "Every personality wears its provider, model, and colors — pick one and the chat becomes theirs.",
  );

  await selectPersonalityInPicker(page, cast.personalities.aria.id);
  await expect(modelPickerTrigger(page)).toContainText(cast.personalities.aria.name, {
    timeout: 30_000,
  });
  await beat(page);
  await recorder.shot(
    "picker-selected",
    "The chat is now Aria's",
    "The composer runs with Aria's model, prompt, and voice — one tap to switch back.",
  );

  await recorder.finish(testInfo);
});
