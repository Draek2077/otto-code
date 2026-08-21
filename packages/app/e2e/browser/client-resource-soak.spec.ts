import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { awaitAssistantMessage, expectAgentIdle } from "../support/helpers/agent-stream";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  formatTrendTable,
  readQueryHotspots,
  readResourceReport,
  readResourceSamples,
  readResourceTrend,
  resetResourceMonitor,
  takeResourceSample,
  waitForResourceMonitor,
} from "../support/helpers/resource-monitor";
import { getServerId } from "../support/helpers/server-id";
import { selectWorkspaceInSidebar } from "../support/helpers/sidebar";

// The instrument for "app-wide FPS degrades the longer Otto stays open".
//
// A real session degrades over hours; this compresses the *shape* of it - switch
// workspace, mount a chat, drive a turn, repeat - and reads the resource
// monitor's growth ranking out of the page. What it is good at is retention:
// anything that climbs monotonically across identical cycles is being kept when
// it should have been released. It is deliberately NOT a frame-rate benchmark: a
// Playwright browser is not a fair FPS sample, so `frames.*` is reported for
// completeness and never asserted on.
//
// The one rule the harness must obey: **navigate in-app, never `page.goto`**. A
// reload rebuilds every store and empties the query cache, which resets exactly
// the state the soak exists to measure - the first version of this spec did that
// and reported a perfectly healthy app.
//
// Opt-in, like the terminal perf specs - it is slow by construction.
//   OTTO_RESOURCE_SOAK_E2E=1 npx playwright test client-resource-soak
//   OTTO_RESOURCE_SOAK_CYCLES=24       (default 12)
//   OTTO_RESOURCE_SOAK_WORKSPACES=6    (default 4)
//
// The workspace count is a parameter because the deck has a retention cap
// (`WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES`, 3). Seeding at or below the cap
// measures a deck that never evicts, and "retained because nothing reclaims it"
// then looks identical to "retained because the cap was never reached" - which
// is exactly the mistake the 2026-07-25 finding made with three workspaces.
// Default above the cap so the eviction path is exercised by default.
const RUN_SOAK = process.env.OTTO_RESOURCE_SOAK_E2E === "1";
const soakDescribe = RUN_SOAK ? test.describe : test.describe.skip;

const CYCLES = Number(process.env.OTTO_RESOURCE_SOAK_CYCLES ?? "12");
const WORKSPACE_COUNT = Number(process.env.OTTO_RESOURCE_SOAK_WORKSPACES ?? "4");

// How many workspace trees the deck is holding right now. This is the direct
// read of whether retention is bounded - `query.observers` is the consequence,
// this is the cause, and having both is what separates "eviction never ran"
// from "eviction ran but released nothing".
async function readMountedWorkspaceTreeCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="workspace-deck-entry-"]').count();
}

// Time until the *target* workspace is the one on screen. Deliberately not
// `expectComposerVisible`: that resolves `.first()` across every retained
// panel, and during a cold switch the outgoing workspace is still painted
// (the deck defers a cold mount on purpose), so it can be satisfied by the
// workspace being navigated away from. An inactive deck entry is
// `display: none`, so its own visibility is the unambiguous signal.
async function waitForWorkspaceOnScreen(page: Page, workspaceId: string): Promise<void> {
  await expect(
    page.getByTestId(`workspace-deck-entry-${getServerId()}:${workspaceId}`),
  ).toBeVisible({ timeout: 30_000 });
}

function formatSeries(label: string, values: number[]): string {
  return `  ${label.padEnd(20)} ${values.map((value) => String(value).padStart(6)).join("")}`;
}

soakDescribe("Client resource soak", () => {
  test.describe.configure({ timeout: 180_000 + CYCLES * 45_000 });

  const workspaces: MockAgentWorkspace[] = [];

  test.beforeAll(async () => {
    for (let index = 0; index < WORKSPACE_COUNT; index += 1) {
      workspaces.push(
        await seedMockAgentWorkspace({
          repoPrefix: `soak-${index}-`,
          title: `Soak ${index + 1}`,
        }),
      );
    }
  });

  test.afterAll(async () => {
    for (const workspace of workspaces) {
      await workspace.cleanup();
    }
  });

  test("repeated chat cycles do not retain state without bound", async ({ page }, testInfo) => {
    test.setTimeout(180_000 + CYCLES * 45_000);

    // The single allowed navigation: boot straight into the chat so the tab
    // exists. Everything after this is in-app.
    const home = workspaces[0];
    await openAgentRoute(page, { workspaceId: home.workspaceId, agentId: home.agentId });
    await expectComposerVisible(page);
    await waitForResourceMonitor(page);

    // Baseline is "booted and settled", so first-paint allocation is not counted
    // as growth.
    await resetResourceMonitor(page);
    await page.waitForTimeout(2_000);
    await takeResourceSample(page);

    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      // Every cycle is identical by construction - same workspace, same chat,
      // one more turn. Nothing here legitimately allocates a new workspace, tab
      // or agent, so anything other than the chat transcript that keeps climbing
      // is being retained rather than used.
      await submitMessage(page, `soak cycle ${cycle + 1}`);
      await awaitAssistantMessage(page);
      await expectAgentIdle(page, 60_000);

      // Mount/unmount churn without a reload: leave the workspace and come back.
      const away = workspaces[(cycle % (workspaces.length - 1)) + 1];
      await selectWorkspaceInSidebar(page, away.workspaceId);
      await page.waitForTimeout(500);
      await selectWorkspaceInSidebar(page, home.workspaceId);
      await expectComposerVisible(page);

      await takeResourceSample(page);
    }

    const trend = await readResourceTrend(page);
    const samples = await readResourceSamples(page);
    const report = await readResourceReport(page);

    await testInfo.attach("resource-trend", {
      body: JSON.stringify(trend, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("resource-samples", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("resource-report", { body: report, contentType: "text/plain" });

    console.log(`\nResource soak: ${CYCLES} cycles, ${samples.length} samples`);
    console.log(formatTrendTable(trend));
    console.log(`\n${report}`);

    // The soak's only hard assertion is that the instrument produced a usable
    // series across the whole run - if the page reloaded, the sample count drops
    // and the growth ranking is meaningless. Thresholds on individual metrics
    // belong in targeted regression tests, not here: a growth budget guessed in
    // advance would just encode today's leak as acceptable.
    expect(samples.length).toBeGreaterThanOrEqual(CYCLES);
    expect(trend.all.length).toBeGreaterThan(0);
  });

  // The control for the test above. Same mount/unmount churn, but no turns -
  // so the chat transcript, the timeline stores and the DOM the transcript
  // renders all stay the same size. Anything that still climbs here cannot be
  // explained by "the conversation got longer": it is retention on the
  // navigation path itself.
  test("workspace switching alone does not retain state", async ({ page }, testInfo) => {
    test.setTimeout(120_000 + CYCLES * 15_000);

    const home = workspaces[0];
    await openAgentRoute(page, { workspaceId: home.workspaceId, agentId: home.agentId });
    await expectComposerVisible(page);
    await waitForResourceMonitor(page);

    await resetResourceMonitor(page);
    await page.waitForTimeout(2_000);
    await takeResourceSample(page);

    // Per-cycle hotspots, so growth can be attributed to a query family rather
    // than left as a bare "observers went up" number.
    const hotspotSeries: Array<Record<string, number>> = [];
    const recordHotspots = async () => {
      const hotspots = await readQueryHotspots(page);
      hotspotSeries.push(
        Object.fromEntries(hotspots.map((hotspot) => [hotspot.key, hotspot.observers])),
      );
    };
    // The deck's mounted-tree count, sampled at the same cadence. Read the
    // series, not the endpoints: a count that climbs to the cap and stops is
    // eviction working, and is indistinguishable from an unbounded one in any
    // summary that reports only first/last.
    const mountedTreeSeries: number[] = [];
    const distinctWorkspacesVisited = new Set<string>([home.workspaceId]);
    // The other half of the retention trade-off. A lower cap buys a smaller
    // resident set and pays for it here: returning to an evicted workspace is a
    // cold mount, not a visibility toggle. Reported alongside the resource
    // series so the cap is never argued from one side only.
    const switchBackMs: number[] = [];
    await recordHotspots();
    mountedTreeSeries.push(await readMountedWorkspaceTreeCount(page));

    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      const away = workspaces[(cycle % (workspaces.length - 1)) + 1];
      distinctWorkspacesVisited.add(away.workspaceId);
      await selectWorkspaceInSidebar(page, away.workspaceId);
      await page.waitForTimeout(500);
      const switchBackStartedAt = Date.now();
      await selectWorkspaceInSidebar(page, home.workspaceId);
      await waitForWorkspaceOnScreen(page, home.workspaceId);
      switchBackMs.push(Date.now() - switchBackStartedAt);
      await expectComposerVisible(page);
      await takeResourceSample(page);
      await recordHotspots();
      mountedTreeSeries.push(await readMountedWorkspaceTreeCount(page));
    }

    const trend = await readResourceTrend(page);
    const samples = await readResourceSamples(page);
    const hotspots = await readQueryHotspots(page);
    const report = await readResourceReport(page);

    const firstHotspots = hotspotSeries[0];
    const lastHotspots = hotspotSeries[hotspotSeries.length - 1];
    const attribution = Object.keys(lastHotspots)
      .map((key) => ({
        key,
        first: firstHotspots[key] ?? 0,
        last: lastHotspots[key],
        delta: lastHotspots[key] - (firstHotspots[key] ?? 0),
      }))
      .filter((row) => row.delta !== 0)
      .sort((left, right) => right.delta - left.delta);

    await testInfo.attach("navigation-hotspot-series", {
      body: JSON.stringify(hotspotSeries, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("navigation-hotspot-attribution", {
      body: JSON.stringify(attribution, null, 2),
      contentType: "application/json",
    });

    console.log("\nObserver growth by query family (navigation-only):");
    for (const row of attribution) {
      console.log(
        `  ${row.key.padEnd(34)} ${String(row.first).padStart(5)} -> ${String(row.last).padStart(5)}  (${row.delta > 0 ? "+" : ""}${row.delta})`,
      );
    }

    // The cap-boundary readout. Everything above summarises; this is the series
    // the diagnosis has to be read off.
    console.log(
      `\nCap boundary: ${WORKSPACE_COUNT} workspaces seeded, ${distinctWorkspacesVisited.size} visited, ${CYCLES} cycles`,
    );
    console.log(formatSeries("mounted trees", mountedTreeSeries));
    console.log(formatSeries("switch-back ms", switchBackMs));
    const sortedSwitchBackMs = [...switchBackMs].sort((left, right) => left - right);
    console.log(
      `  switch-back median ${sortedSwitchBackMs[Math.floor(sortedSwitchBackMs.length / 2)]}ms, worst ${sortedSwitchBackMs[sortedSwitchBackMs.length - 1]}ms`,
    );
    console.log(
      formatSeries(
        "query.observers",
        samples.map((sample) => sample.metrics["query.observers"] ?? 0),
      ),
    );
    console.log(
      formatSeries(
        "dom.nodes",
        samples.map((sample) => sample.metrics["dom.nodes"] ?? 0),
      ),
    );
    console.log(
      formatSeries(
        "frames.fps",
        samples.map((sample) => Math.round(sample.metrics["frames.fps"] ?? 0)),
      ),
    );
    console.log(
      formatSeries(
        "frames.p95FrameMs",
        samples.map((sample) => Math.round(sample.metrics["frames.p95FrameMs"] ?? 0)),
      ),
    );

    await testInfo.attach("navigation-mounted-tree-series", {
      body: JSON.stringify(mountedTreeSeries, null, 2),
      contentType: "application/json",
    });

    await testInfo.attach("navigation-trend", {
      body: JSON.stringify(trend, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("navigation-hotspots", {
      body: JSON.stringify(hotspots, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("navigation-report", { body: report, contentType: "text/plain" });

    console.log(`\nNavigation-only soak: ${CYCLES} cycles, ${samples.length} samples`);
    console.log(formatTrendTable(trend));
    console.log(`\n${report}`);

    expect(samples.length).toBeGreaterThanOrEqual(CYCLES);
  });
});
