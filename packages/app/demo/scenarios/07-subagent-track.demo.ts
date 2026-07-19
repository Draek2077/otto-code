import { expect, test } from "../../e2e/fixtures";
import { getServerId } from "../../e2e/helpers/server-id";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 07 — Sub-agent tracking (one feature: provider subagents promoted
 * to observed track rows). A real Claude run fans work out to two parallel
 * Task subagents; the track renders them as read-only rows while they work.
 *
 * Real-run scenario: costs tokens, non-deterministic mid-run. All waits are
 * state-based with generous budgets; a run that never spawns subagents fails
 * loudly instead of capturing garbage (re-record is cheap).
 */

const REAL = process.env.DEMO_REAL === "1" || Boolean(process.env.E2E_FORK_OTTO_HOME_FROM);
test.skip(!REAL, "Real-run scenario: run via npm run demo:real (DEMO_REAL=1).");

let workspace: DemoWorkspace;
let storefront: DemoWorkspace;

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
    title: "API audit",
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("subagent tracking walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `07-subagent-track-${theme}`);
  const serverId = getServerId();

  // The orchestration prompt: two clearly-parallel read-only audits, so the
  // fan-out is fast, cheap, and never mutates the staged repo.
  const agent = await workspace.client.createAgent({
    provider: "claude",
    cwd: workspace.repo.path,
    workspaceId: workspace.workspaceId,
    model: "opus",
    title: "API audit",
    // No client is watching to answer permission prompts — the default "Always
    // Ask" mode would stall on the first Task-tool subagent spawn forever.
    // dontAsk is the Agent SDK's headless posture (docs/safe-unattended.md):
    // runs without prompting, anything not pre-approved is denied rather than
    // stalling.
    modeId: "dontAsk",
    initialPrompt:
      "Use two subagents in parallel: one audits the API routes in src/routes for validation gaps, the other reviews the test coverage in test/. Wait for both, then summarize the two reports as one short prioritized list. Read-only — make no code changes.",
  });

  const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, workspace.workspaceId);
  await page.goto(agentRoute);
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
  await beat(page);
  await recorder.shot(
    "orchestrator",
    "One agent, delegating",
    "The orchestrator plans the audit and fans the work out to subagents.",
  );

  // The track header appears as soon as the first subagent is observed.
  const trackHeader = page.getByTestId("subagents-track-header");
  await expect(trackHeader).toBeVisible({ timeout: 300_000 });
  const anyRow = page.locator('[data-testid^="subagents-track-row-"]').first();
  if (!(await anyRow.isVisible().catch(() => false))) {
    await humanClick(page, trackHeader);
  }
  await expect(anyRow).toBeVisible({ timeout: 120_000 });
  await beat(page);
  await recorder.shot(
    "track-rows",
    "Subagents, tracked live",
    "Each subagent gets its own read-only row — what it's doing, right now, without leaving the parent chat.",
  );

  // Open one subagent's read-only view.
  await humanClick(page, anyRow);
  await beat(page);
  await recorder.shot(
    "subagent-view",
    "Look inside any subagent",
    "The full transcript of a subagent's work, read-only — the parent stays in control.",
  );

  // Back to the orchestrator for the synthesis payoff.
  await workspace.client.waitForFinish(agent.id, 480_000);
  await page.goto(agentRoute);
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
  await beat(page);
  await recorder.shot(
    "synthesis",
    "The reports come home",
    "Both audits land back in the orchestrator, merged into one prioritized summary.",
  );

  await recorder.finish(testInfo);
});
