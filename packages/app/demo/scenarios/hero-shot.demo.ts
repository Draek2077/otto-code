import { expect, test } from "../../e2e/fixtures";
import { connectPersonalitiesClient } from "../../e2e/helpers/personalities";
import { getServerId } from "../../e2e/helpers/server-id";
import { openVisualizerFromHeader, visualizerIframe } from "../../e2e/helpers/visualizer";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, pause, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * The flagship "everything at once" shot — not a feature tutorial (see the
 * numbered scenarios), the source image for the website's og-image and the
 * hero-mockup used across the alternatives pages. Both currently show stale
 * pre-fork Paseo screenshots.
 *
 * One real Claude turn, started with the shipped starter personality Atlas
 * (not the demo cast — this is the site's default "meet your agent" moment),
 * chat and the Visualizer split side by side. openVisualizerFromHeader
 * auto-splits to the right of the focused pane whenever that pane has a
 * companion tab (see src/visualizer/open-visualizer-tab.ts), so opening the
 * Visualizer once the agent route is focused produces the split for free.
 */

const REAL = process.env.DEMO_REAL === "1" || Boolean(process.env.E2E_FORK_OTTO_HOME_FROM);
test.skip(!REAL, "Real-run scenario: run via npm run demo:real (DEMO_REAL=1).");

const ATLAS_PERSONALITY_ID = "personality_builtin_atlas";

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
    title: "Rate counter",
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("hero shot: chat and visualizer, Atlas on the case", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `hero-shot-${theme}`);
  const serverId = getServerId();

  const personalities = await connectPersonalitiesClient();
  const agent = await personalities.createAgent({
    provider: "claude",
    cwd: workspace.repo.path,
    workspaceId: workspace.workspaceId,
    title: "Rate counter",
    personality: ATLAS_PERSONALITY_ID,
    // No client is watching to answer permission prompts — the default "Always
    // Ask" mode would stall on the first edit forever. dontAsk is the Agent
    // SDK's headless posture (docs/safe-unattended.md): runs without
    // prompting, anything not pre-approved is denied rather than stalling.
    modeId: "dontAsk",
    initialPrompt: "Add a request-rate counter to the /health endpoint and cover it with a test.",
  });
  await personalities.close();

  await page.goto(buildHostAgentDetailRoute(serverId, agent.id, workspace.workspaceId));
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
  await beat(page);

  // No wait on "turn underway" here: dontAsk auto-approves every pre-approved
  // tool call with no round trip, so a small task like this can finish before
  // any single-state assertion would reliably catch it mid-flight (confirmed
  // empirically — see runbook gotcha 19). Whether the turn is still running or
  // already idle by this point, the Visualizer still opens and the chat pane
  // still shows real content either way (mirrors 08-visualizer's approach).
  await openVisualizerFromHeader(page);
  await expect(visualizerIframe(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText("The Visualizer couldn't start")).toHaveCount(0);
  // Constellation settle + a little more streamed chat content before the shot.
  await pause(page, 5_000);

  await recorder.shot(
    "hero",
    "Chat and the Visualizer, side by side",
    "Atlas works the request while the Visualizer shows the run live — the same split any agent gets.",
  );

  await recorder.finish(testInfo);
});
