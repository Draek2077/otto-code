import { expect, test } from "../../e2e/fixtures";
import {
  connectPersonalitiesClient,
  openModelPersonalityPicker,
} from "../../e2e/helpers/personalities";
import { getServerId } from "../../e2e/helpers/server-id";
import { openVisualizerFromHeader, visualizerIframe } from "../../e2e/helpers/visualizer";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * The flagship "everything at once" shot - not a feature tutorial (see the
 * numbered scenarios), the source image for the website's og-image and the
 * hero-mockup used across the alternatives pages. Both currently show stale
 * pre-fork Otto screenshots.
 *
 * One real Claude turn, started with the shipped starter personality Atlas
 * (not the demo cast - this is the site's default "meet your agent" moment),
 * chat, the real project diff and the Visualizer PIP. The hero is deliberately
 * dense: a visible workspace rail, a readable conversation, a composer, a
 * useful Changes pane and live agent context - never an empty canvas.
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

test("hero shot: chat and changes, Atlas on the case", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `hero-shot-${theme}`);
  const serverId = getServerId();

  const personalities = await connectPersonalitiesClient();
  const agent = await personalities.createAgent({
    provider: "claude",
    cwd: storefront.repo.path,
    workspaceId: storefront.workspaceId,
    title: "Review storefront search",
    personality: ATLAS_PERSONALITY_ID,
    // No client is watching to answer permission prompts - the default "Always
    // Ask" mode would stall on the first edit forever. dontAsk is the Agent
    // SDK's headless posture (docs/safe-unattended.md): runs without
    // prompting, anything not pre-approved is denied rather than stalling.
    modeId: "dontAsk",
    initialPrompt:
      "Review the uncommitted storefront-search changes. Summarize what they add and call out anything that should be addressed before the change is committed. Read-only: do not edit files.",
  });
  await personalities.close();

  await storefront.client.waitForFinish(agent.id, 480_000);

  await page.goto(buildHostAgentDetailRoute(serverId, agent.id, storefront.workspaceId));
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
  await beat(page);

  const openExplorer = page.getByRole("button", { name: "Open explorer" }).first();
  await expect(openExplorer).toBeVisible({ timeout: 30_000 });
  await openExplorer.click();
  await page.getByTestId("explorer-tab-changes").click();
  await expect(page.getByTestId("diff-file-0")).toBeVisible({ timeout: 30_000 });
  const diffBody = page.getByTestId("diff-file-0-body");
  if (!(await diffBody.isVisible().catch(() => false))) {
    await page.getByTestId("diff-file-0").click();
  }
  await expect(diffBody).toBeVisible({ timeout: 30_000 });

  // Boot the full Visualizer tab, then collapse it into the ambient PIP. The
  // two surfaces are mutually exclusive, so opening only the tab would hide
  // the PIP that this hero promises.
  await openVisualizerFromHeader(page);
  await expect(visualizerIframe(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText("The Visualizer couldn't start")).toHaveCount(0);
  await expect(page.getByTestId("visualizer-toolbar-pip")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("visualizer-toolbar-pip").click();
  await expect(page.locator('iframe[title="visualizer"]:visible')).toBeVisible({
    timeout: 30_000,
  });
  await openModelPersonalityPicker(page);
  await expect(page.getByTestId("combobox-desktop-container")).toBeVisible({ timeout: 15_000 });
  await beat(page);

  await recorder.shot(
    "hero",
    "Everything in view",
    "Atlas reviews a real storefront change with the PR diff, Visualizer PIP, and model picker open together.",
  );

  await recorder.finish(testInfo);
});
