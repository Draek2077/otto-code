import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/fixtures";
import { getServerId } from "../../e2e/helpers/server-id";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import {
  buildHostAgentDetailRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
} from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { DemoRecorder } from "../helpers/capture";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Feature spread — not a step-by-step demo, but a sweep of stills across the
 * app's surfaces for the website's feature sections and store listings. Runs
 * in two Playwright projects: `spread` (desktop 1440×900) and `spread-mobile`
 * (390×844 at 3× — Play-Store-ready portrait PNGs). Assets land in
 * demo/.out/feature-spread[-mobile]/.
 *
 * The agent-chat surface needs a real provider turn; it only runs when
 * provider auth was forked into the demo home (npm run demo:spread:real) and
 * is skipped otherwise.
 */

let storefront: DemoWorkspace;
let pulse: DemoWorkspace;

test.beforeAll(async () => {
  // Seed both staged projects so lists and sidebars look lived-in.
  storefront = await seedDemoWorkspace({
    template: "mango-storefront",
    originOwner: "mango-labs",
    title: "Storefront search",
  });
  pulse = await seedDemoWorkspace({
    template: "pulse-api",
    originOwner: "pulse-labs",
    title: "Rate limiting",
  });
});

test.afterAll(async () => {
  await pulse?.cleanup();
  await storefront?.cleanup();
});

function isPhoneProject(projectName: string): boolean {
  return projectName.includes("mobile") || projectName.includes("ios");
}

/**
 * Diff expanded-state persists per workspace on the device, so a later visit
 * in the same browser session may find the first file already expanded —
 * clicking it again would collapse it. Only click when the body is hidden.
 */
async function expandFirstDiffIfCollapsed(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0")).toBeVisible({ timeout: 30_000 });
  const body = page.getByTestId("diff-file-0-body");
  if (!(await body.isVisible().catch(() => false))) {
    await page.getByTestId("diff-file-0").click();
  }
  await expect(body).toBeVisible({ timeout: 30_000 });
}

/**
 * Per-platform capture themes: desktop/site spreads run both site-default
 * themes (Twilight/Daylight, see demo/helpers/theme.ts) — Android phone and
 * tablet stay stock dark, iOS stays light, matching each store's own
 * screenshot conventions rather than the site's branding.
 */
function appearanceForProject(projectName: string): Parameters<typeof applyDemoAppearance>[1] {
  if (projectName.includes("ios")) {
    return { colorSchemeMode: "light" };
  }
  if (projectName === "spread-twilight" || projectName === "spread-daylight") {
    return demoThemeAppearance(resolveDemoTheme(projectName));
  }
  return {};
}

/**
 * Waits for any of the given markers to appear, then returns. A spread shot
 * should degrade to a timed settle (with a warning) rather than fail the
 * whole sweep when one surface's markers drift.
 */
async function settleOnAnyMarker(page: Page, markers: string[], timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const marker of markers) {
      if (
        await page
          .getByText(marker, { exact: false })
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  console.warn(`[demo] No marker of [${markers.join(", ")}] appeared; capturing anyway.`);
}

test("feature spread", async ({ page }, testInfo) => {
  const mobile = isPhoneProject(testInfo.project.name);
  // Each Playwright project (spread / spread-mobile / spread-tablet /
  // spread-ios) writes its own .out scenario dir: feature-spread[-*].
  const scenario = `feature-${testInfo.project.name}`;
  await applyDemoAppearance(page, appearanceForProject(testInfo.project.name));
  const recorder = await DemoRecorder.start(page, scenario);
  const settle = () => page.waitForTimeout(1_200);

  await page.goto("/");
  await settleOnAnyMarker(page, ["Storefront search", "Workspaces", "New agent"]);
  await settle();
  await recorder.shot("home", "Home", "Start an agent in any project, from anywhere.");

  if (!mobile) {
    // Workspace with the explorer + pending diff open — the IDE surface.
    await gotoWorkspace(page, storefront.workspaceId);
    await page.getByRole("button", { name: "Open explorer" }).first().click();
    await page.getByTestId("explorer-tab-changes").click();
    await expandFirstDiffIfCollapsed(page);
    await settle();
    await recorder.shot("workspace-diff", "Workspace", "Files, diffs, and agents side by side.");
  }

  const serverId = getServerId();
  const surfaces: Array<{ name: string; title: string; route: string }> = [
    {
      name: "settings-appearance",
      title: "Appearance",
      route: buildSettingsSectionRoute("appearance"),
    },
    {
      name: "settings-general",
      title: "General settings",
      route: buildSettingsSectionRoute("general"),
    },
    {
      name: "host-agents",
      title: "Agent settings",
      route: buildSettingsHostSectionRoute(serverId, "agents"),
    },
    {
      name: "host-providers",
      title: "Providers",
      route: buildSettingsHostSectionRoute(serverId, "providers"),
    },
  ];

  for (const surface of surfaces) {
    await page.goto(surface.route);
    await settle();
    await recorder.shot(surface.name, surface.title);
  }

  // Agent chat runs a real provider turn; opt in with DEMO_REAL=1 (Claude
  // auth is machine-level, so no home fork is needed) or by forking a home.
  // The agent runs in the storefront workspace and reviews its staged
  // working-tree changes, so the chat content matches the diff panel that the
  // agent-diff surface opens beside it.
  if (process.env.DEMO_REAL === "1" || process.env.E2E_FORK_OTTO_HOME_FROM) {
    const agent = await storefront.client.createAgent({
      provider: "claude",
      cwd: storefront.repo.path,
      workspaceId: storefront.workspaceId,
      model: "opus",
      title: "Review search changes",
      initialPrompt:
        "Look at the uncommitted changes in this repo and give me a short review: what do they add, and is anything missing before we commit?",
    });
    await storefront.client.waitForFinish(agent.id, 300_000);
    await page.goto(buildHostAgentDetailRoute(serverId, agent.id, storefront.workspaceId));
    await page.waitForURL(
      (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
      { timeout: 60_000 },
    );
    await settle();
    await recorder.shot("agent-chat", "Agent chat", "A real agent turn, streamed to your pocket.");

    if (!mobile) {
      // Agent chat + the diff it just reviewed, side by side. The explorer
      // panel state persisted from the workspace-diff surface earlier in this
      // session, so it may already be open — only click the button if shown.
      const openExplorer = page.getByRole("button", { name: "Open explorer" }).first();
      if (await openExplorer.isVisible().catch(() => false)) {
        await openExplorer.click();
      }
      await page.getByTestId("explorer-tab-changes").click();
      await expandFirstDiffIfCollapsed(page);
      await settle();
      await recorder.shot(
        "agent-diff",
        "Agent chat with the diff open",
        "Review the change and the conversation that produced it, side by side.",
      );
    }
  } else {
    console.log("[demo] Skipping agent-chat surface: run demo:spread:real to include it.");
  }

  await recorder.finish(testInfo);
});
