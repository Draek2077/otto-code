import { expect, test } from "../../e2e/fixtures";
import { composerLocator } from "../../e2e/helpers/composer";
import { getServerId } from "../../e2e/helpers/server-id";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 09 — Composer intelligence (one feature pair that lives in the
 * composer: ghost-text prompt suggestions and suggested-task chips). One real
 * Claude turn produces both honestly: the staged pulse-api carries a
 * deliberate out-of-scope TODO (unvalidated `limit` in /events/recent) for
 * the agent to flag via spawn_task, and the provider streams a next-prompt
 * suggestion when the turn ends.
 *
 * Non-determinism: the agent may not flag the task or emit a suggestion on a
 * given run — the waits fail loudly and the take is re-recorded (playbook).
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
    title: "Health counter",
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
  await storefront?.cleanup();
});

test("composer intelligence walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `09-composer-intelligence-${theme}`);
  const serverId = getServerId();

  const agent = await workspace.client.createAgent({
    provider: "claude",
    cwd: workspace.repo.path,
    workspaceId: workspace.workspaceId,
    model: "opus",
    title: "Health counter",
    // No client is watching to answer permission prompts — the default "Always
    // Ask" mode would stall on the first edit forever. dontAsk is the Agent
    // SDK's headless posture (docs/safe-unattended.md): runs without
    // prompting, anything not pre-approved is denied rather than stalling.
    modeId: "dontAsk",
    initialPrompt:
      "Add a requestCount field to the GET /health response that counts requests served since boot. Keep the change minimal. While reading, if you spot unrelated issues worth their own follow-up, flag each as a suggested task instead of fixing it here.",
  });

  await page.goto(buildHostAgentDetailRoute(serverId, agent.id, workspace.workspaceId));
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });

  const input = composerLocator(page);
  const idlePlaceholder = (await input.getAttribute("placeholder").catch(() => null)) ?? "";

  // ── Suggested-task chips (spawn_task fires mid-run) ───────────────────────
  const overlay = page.getByTestId("suggested-tasks-overlay");
  await expect(overlay).toBeVisible({ timeout: 300_000 });
  await beat(page);
  await recorder.shot(
    "task-chip",
    "Out-of-scope work becomes a chip",
    "The agent noticed something worth fixing — and flagged it as a task instead of bloating the change.",
  );

  const caret = overlay.locator('[data-testid$="-caret"]').first();
  if (await caret.isVisible().catch(() => false)) {
    await caret.click();
    await beat(page);
    await recorder.shot(
      "task-chip-menu",
      "Spin it off in one click",
      "Start the task in its own chat — attended, unattended, or in a fresh worktree.",
    );
    await page.keyboard.press("Escape");
  }

  // ── Ghost prompt (suggestion arrives as the turn ends) ────────────────────
  await workspace.client.waitForFinish(agent.id, 480_000);
  await expect
    .poll(
      async () => {
        const placeholder = (await input.getAttribute("placeholder").catch(() => null)) ?? "";
        return placeholder !== "" && placeholder !== idlePlaceholder;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  const suggestion = (await input.getAttribute("placeholder")) ?? "";
  await beat(page);
  await recorder.shot(
    "ghost-prompt",
    "The next prompt, ghosted in",
    "When a turn ends, the agent suggests your likely next step as ghost text in the composer.",
  );

  // Tab accepts the ghost text into the draft.
  await input.click();
  await input.press("Tab");
  await expect(input).toHaveValue(suggestion, { timeout: 15_000 });
  await beat(page);
  await recorder.shot(
    "ghost-accepted",
    "Tab to accept",
    "One keystroke turns the suggestion into your draft — edit it or just hit send.",
  );

  await recorder.finish(testInfo);
});
