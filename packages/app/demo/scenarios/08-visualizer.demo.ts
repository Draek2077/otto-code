import { expect, test } from "../../e2e/fixtures";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import {
  openVisualizerChatsDropdown,
  openVisualizerFromHeader,
  visualizerIframe,
} from "../../e2e/helpers/visualizer";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, pause, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 08 — The Visualizer (one feature: the live agent constellation).
 * A real Claude run streams while the Visualizer tab is open, so the node is
 * genuinely active in every shot.
 *
 * Capture caveat: the guest canvas is WebGL. Headless capture may software-
 * render or blank depending on the machine — inspect the first DEMO_REAL
 * take, and if the canvas is empty re-run headed (the DOM waits below only
 * prove the guest booted, never what it drew; that's a deliberate e2e rule
 * this scenario inherits).
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
    title: "Ring buffer tour",
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("visualizer walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `08-visualizer-${theme}`);

  // A read-heavy, no-edit prompt: plenty of visible tool activity for the
  // node to animate through, nothing mutated in the staged repo.
  const agent = await workspace.client.createAgent({
    provider: "claude",
    cwd: workspace.repo.path,
    workspaceId: workspace.workspaceId,
    model: "opus",
    title: "Ring buffer tour",
    initialPrompt:
      "Read through src/ and explain how the event ring buffer works — ingestion, eviction, and the gauges. Short summary at the end. Read-only, no code changes.",
  });

  await gotoWorkspace(page, workspace.workspaceId);
  await beat(page);
  await recorder.shot(
    "entry",
    "One button away",
    "The Visualizer opens from the workspace header, right next to your tabs.",
  );

  await openVisualizerFromHeader(page);
  await expect(visualizerIframe(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText("The Visualizer couldn't start")).toHaveCount(0);
  // Let the constellation settle into its orbit before the first canvas shot.
  await pause(page, 4_000);
  await recorder.shot(
    "constellation",
    "Your agents, as a living constellation",
    "Every chat is a node — pulsing while it thinks, orbited by the tools it calls.",
  );

  const dialog = await openVisualizerChatsDropdown(page);
  await beat(page);
  await recorder.shot(
    "chats",
    "Jump between chats",
    "The toolbar mirrors the live session list — focus any agent's node from here.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  await workspace.client.waitForFinish(agent.id, 480_000);
  await pause(page, 3_000);
  await recorder.shot(
    "settled",
    "Work done, node at rest",
    "When the turn ends the node settles to idle — the constellation always tells the truth.",
  );

  await recorder.finish(testInfo);
});
