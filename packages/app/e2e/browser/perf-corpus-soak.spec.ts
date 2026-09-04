import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  loadPerfCorpus,
  type CorpusScale,
  type SeededCorpus,
} from "../support/helpers/perf-corpus";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { selectWorkspaceInSidebar } from "../support/helpers/sidebar";
import { createTempGitRepo, type TempDirectory } from "../support/helpers/workspace";
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
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";

// The instrument for "Otto gets slow once I have a lot open".
//
// `client-resource-soak.spec.ts` is the sibling of this file and answers a
// different question. It drives *empty* workspaces with *idle* agents and adds
// one turn per cycle, which makes it a good retention detector and a poor model
// of the reported symptom: nobody complains about Otto with four empty chats
// open. This one starts from a corpus that already looks like a heavy install -
// several projects, worktree workspaces under each, a dozen chats per workspace,
// hundreds of messages per chat - and measures what it costs to move around
// inside it.
//
// Three things here are load-bearing and easy to lose in a refactor:
//
//   1. **Navigate in-app, never `page.goto`.** A reload rebuilds every store and
//      empties the query cache, resetting exactly the state under measurement.
//      One boot navigation is allowed; everything after it is a click.
//   2. **The corpus content must stay combinatorially unique.** The app caches
//      rendered markdown block heights keyed by block text, so a corpus built
//      from repeated strings hits that cache on nearly every block and reports
//      the app as far faster than it is. `scripts/perf-corpus.mjs` composes its
//      content for this reason; do not "simplify" it to a fixture list.
//   3. **Seeding is not free.** The default corpus is ~2,900 mock turns. The
//      timings below are sized for that, and the seed cost is reported rather
//      than hidden so a slow run can be attributed to the right half.
//
// Opt-in, like the other performance instruments - it is slow by construction.
//   OTTO_CORPUS_SOAK_E2E=1 npx playwright test perf-corpus-soak
//   OTTO_CORPUS_PROJECTS / _WORKSPACES / _CHATS / _TURNS / _ITEMS  (scale knobs)
//   OTTO_CORPUS_CONCURRENCY=24    (seeding parallelism, default 24 here)
const RUN_SOAK = process.env.OTTO_CORPUS_SOAK_E2E === "1";
const CAPTURE_CPU_PROFILE = process.env.OTTO_CORPUS_CPU_PROFILE === "1";
const MOUNTED_RECENT_ITEMS_OVERRIDE = Number(process.env.OTTO_CORPUS_MOUNTED_RECENT_ITEMS);
const soakDescribe = RUN_SOAK ? test.describe : test.describe.skip;

// A soak-sized default, deliberately below the dev script's. The full corpus is
// 288 chats; seeding that inside a Playwright `beforeAll` on CI hardware costs
// more than the measurement is worth, and every dimension here still clears the
// cap it exists to exercise: 3 workspaces per project x 3 projects = 9 mounted
// candidates against a deck cap of 5, and 13 chats per workspace against a
// stream-buffer cap of 12. Raise it with the env knobs when the question is
// about absolute cost rather than growth.
const SOAK_SCALE: CorpusScale = {
  projects: 3,
  workspacesPerProject: 3,
  chatsPerWorkspace: 13,
  turnsPerChat: 10,
  itemsPerTurn: 30,
};

function formatSeries(label: string, values: Array<number | null>): string {
  return `  ${label.padEnd(22)} ${values
    .map((value) => (value === null ? "-" : String(value)).padStart(6))
    .join("")}`;
}

function summarize(label: string, values: number[]): string {
  if (values.length === 0) {
    return `  ${label}: no samples`;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `  ${label}: median ${median}ms, worst ${sorted[sorted.length - 1]}ms`;
}

interface CpuProfile {
  nodes: Array<{
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
  }>;
  samples?: number[];
  timeDeltas?: number[];
}

function summarizeCpuProfile(profile: CpuProfile): string {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTimeByNodeId = new Map<number, number>();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const nodeId = profile.samples?.[index];
    const elapsedUs = profile.timeDeltas?.[index] ?? 0;
    if (nodeId === undefined) continue;
    selfTimeByNodeId.set(nodeId, (selfTimeByNodeId.get(nodeId) ?? 0) + elapsedUs);
  }
  const rows = [...selfTimeByNodeId]
    .sort(([, left], [, right]) => right - left)
    .slice(0, 12)
    .map(([nodeId, elapsedUs]) => {
      const frame = nodes.get(nodeId)?.callFrame;
      const source = frame?.url ? frame.url.split("/").at(-1) : "native";
      const name = frame?.functionName || "(anonymous)";
      return `  ${Math.round(elapsedUs / 1_000)
        .toString()
        .padStart(4)}ms  ${name} (${source}:${(frame?.lineNumber ?? -1) + 1})`;
    });
  return `CPU profile, top self time\n${rows.join("\n")}`;
}

interface SessionMessage {
  type?: unknown;
  payload?: unknown;
}

function readSessionMessage(frame: string | Buffer): SessionMessage | null {
  try {
    const envelope = JSON.parse(typeof frame === "string" ? frame : frame.toString()) as {
      type?: unknown;
      message?: SessionMessage;
    };
    // Playwright exposes both direct Session frames and relay-wrapped ones.
    // The envelope tag differs, but the actual protocol message is always in
    // `message` when the frame is wrapped.
    return envelope.message ?? envelope;
  } catch {
    return null;
  }
}

/** Measures the full WebSocket round trip, including daemon work, for a timeline page. */
async function observeTimelineFetchLatency(page: Page) {
  const startedAtByRequestId = new Map<string, { agentId: string; startedAt: number }>();
  const completed: Array<{ agentId: string; elapsedMs: number }> = [];

  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((frame) => {
      const message = readSessionMessage(frame);
      if (message?.type === "fetch_agent_timeline_request") {
        const request = message as SessionMessage & { agentId?: unknown; requestId?: unknown };
        if (typeof request.agentId === "string" && typeof request.requestId === "string") {
          startedAtByRequestId.set(request.requestId, {
            agentId: request.agentId,
            startedAt: Date.now(),
          });
        }
      }
      server.send(frame);
    });
    server.onMessage((frame) => {
      const message = readSessionMessage(frame);
      if (message?.type === "fetch_agent_timeline_response") {
        const response = message.payload as { requestId?: unknown } | undefined;
        if (typeof response?.requestId === "string") {
          const started = startedAtByRequestId.get(response.requestId);
          if (started) {
            startedAtByRequestId.delete(response.requestId);
            completed.push({ agentId: started.agentId, elapsedMs: Date.now() - started.startedAt });
          }
        }
      }
      socket.send(frame);
    });
  });

  return {
    mark: () => completed.length,
    findForAgentSince: (agentId: string, mark: number): number | null =>
      completed.slice(mark).findLast((timing) => timing.agentId === agentId)?.elapsedMs ?? null,
  };
}

/**
 * Switches to a chat and returns both the active-tab and history-ready timings.
 *
 * Chats in a workspace are **tabs**, not sidebar rows. Past a handful the tab
 * strip overflows, and the rest are reachable only through the overflow menu -
 * which at corpus scale is most of them, so handling only the visible strip
 * would silently measure the same four chats over and over.
 *
 * The completion signal is the target tab's own `aria-selected`, deliberately
 * not `agent-chat-scroll` being visible: that container belongs to whichever
 * chat is showing and stays visible right through a switch, so waiting on it
 * returns immediately and reports every switch as free. The spinner is the
 * stronger second boundary: on a fresh chat, it covers the panel until the
 * authoritative timeline has been applied.
 */
async function openChatAndTime(
  page: Page,
  agentId: string,
): Promise<{ selectedMs: number; historyReadyMs: number }> {
  const tab = page.getByTestId(`workspace-tab-agent_${agentId}`);
  const visibleHistoryOverlay = page.locator('[data-testid="agent-history-overlay"]:visible');
  const startedAt = Date.now();

  if ((await tab.count()) > 0) {
    await tab.first().click();
  } else {
    await page.getByTestId("workspace-tab-overflow-trigger").click();
    await page.getByTestId(`workspace-tab-overflow-item-agent_${agentId}`).click();
  }

  // Selecting from the overflow promotes the chat into the visible strip, so the
  // same locator is the right one to wait on in both branches.
  await expect(tab.first()).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  const selectedMs = Date.now() - startedAt;
  await expect(visibleHistoryOverlay).toHaveCount(0, { timeout: 60_000 });
  return { selectedMs, historyReadyMs: Date.now() - startedAt };
}

async function readMountedWorkspaceTreeCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="workspace-deck-entry-"]').count();
}

async function waitForWorkspaceOnScreen(page: Page, workspaceId: string): Promise<void> {
  await expect(
    page.getByTestId(`workspace-deck-entry-${getServerId()}:${workspaceId}`),
  ).toBeVisible({ timeout: 60_000 });
}

soakDescribe("Loaded-corpus soak", () => {
  const repos: TempDirectory[] = [];
  let client: SeedDaemonClient | null = null;
  let corpus: SeededCorpus | null = null;

  test.describe.configure({ timeout: 30 * 60_000 });

  test.beforeAll(async () => {
    // `describe.configure({ timeout })` sets the timeout for TESTS, not for
    // hooks - a hook keeps Playwright's 60s default regardless. Seeding the
    // corpus happens here and takes minutes, so without this line the run dies
    // mid-seed with a bare "beforeAll hook timeout" that reads like a hang.
    test.setTimeout(30 * 60_000);

    const { scaleFromEnv, seedPerfCorpus } = await loadPerfCorpus();
    const scale = scaleFromEnv(process.env, SOAK_SCALE);

    for (let index = 0; index < scale.projects; index += 1) {
      repos.push(await createTempGitRepo(`corpus-${index}-`));
    }
    client = await connectSeedClient();
    corpus = await seedPerfCorpus({
      client,
      projects: repos.map((repo, index) => ({ rootPath: repo.path, label: `corpus-${index}` })),
      scale,
      concurrency: Number(process.env.OTTO_CORPUS_CONCURRENCY ?? "24"),
    });
    console.log(
      `\nSeeded ${corpus.totals.chats} chats across ${corpus.totals.workspaces} workspaces ` +
        `in ${corpus.totals.projects} projects ` +
        `(~${corpus.totals.items.toLocaleString()} timeline items) ` +
        `in ${Math.round(corpus.elapsedMs / 1000)}s.`,
    );
  });

  test.afterAll(async () => {
    // Teardown removes a corpus-sized amount of daemon state, so it needs the
    // same treatment as the seed hook rather than the 60s default.
    test.setTimeout(10 * 60_000);

    for (const project of corpus?.projects ?? []) {
      await client?.removeProject(project.projectId).catch(() => undefined);
    }
    await client?.close().catch(() => undefined);
    for (const repo of repos) {
      await repo.cleanup().catch(() => undefined);
    }
  });

  test("walking every chat in a loaded workspace does not retain without bound", async ({
    page,
  }, testInfo) => {
    const seeded = corpus;
    expect(seeded, "corpus was not seeded").not.toBeNull();
    const workspace = seeded!.projects[0].workspaces[0];
    expect(workspace.agentIds.length).toBeGreaterThan(1);
    const timelineFetchLatency = await observeTimelineFetchLatency(page);
    if (Number.isSafeInteger(MOUNTED_RECENT_ITEMS_OVERRIDE) && MOUNTED_RECENT_ITEMS_OVERRIDE > 0) {
      await page.addInitScript((mountedRecentItems) => {
        (
          globalThis as typeof globalThis & { __OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: number }
        ).__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS = mountedRecentItems;
      }, MOUNTED_RECENT_ITEMS_OVERRIDE);
    }

    // The single allowed navigation.
    await page.goto(
      buildHostAgentDetailRoute(getServerId(), workspace.agentIds[0], workspace.workspaceId),
    );
    await waitForResourceMonitor(page);
    await expect(page.getByTestId("agent-chat-scroll").first()).toBeVisible({ timeout: 60_000 });

    await resetResourceMonitor(page);
    await page.waitForTimeout(2_000);
    await takeResourceSample(page);

    // Open each chat in turn. The agent-stream buffers cap at 12 agents, so a
    // workspace of 13 crosses that boundary exactly once - the first chat should
    // have been released by the time the walk ends, which is what the revisit
    // below is for.
    //
    // Read `dom.nodes` as cost-per-mounted-chat, NOT as transcript size: the
    // transcript is virtualized (`agent-chat-scroll-web-dom-virtualized`), so a
    // 300-message chat renders only its visible window. A flat DOM series here
    // is virtualization working, not evidence that history is free.
    const selectionMs: number[] = [];
    const historyReadyMs: number[] = [];
    const timelineFetchMs: Array<number | null> = [];
    const domNodes: number[] = [];
    const profileTargetIndex = Math.min(7, workspace.agentIds.length - 1);
    let cpuProfile: CpuProfile | null = null;
    for (const [index, agentId] of workspace.agentIds.entries()) {
      const latencyMark = timelineFetchLatency.mark();
      let timing: Awaited<ReturnType<typeof openChatAndTime>>;
      if (CAPTURE_CPU_PROFILE && index === profileTargetIndex) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        try {
          timing = await openChatAndTime(page, agentId);
          const stopped = (await cdp.send("Profiler.stop")) as unknown as { profile: CpuProfile };
          cpuProfile = stopped.profile;
        } finally {
          await cdp.detach();
        }
      } else {
        timing = await openChatAndTime(page, agentId);
      }
      selectionMs.push(timing.selectedMs);
      historyReadyMs.push(timing.historyReadyMs);
      timelineFetchMs.push(timelineFetchLatency.findForAgentSince(agentId, latencyMark));
      await takeResourceSample(page);
      const samples = await readResourceSamples(page);
      domNodes.push(samples[samples.length - 1]?.metrics["dom.nodes"] ?? 0);
    }

    // Back to the first chat, which the cap should have evicted. A revisit that
    // costs the same as a first open means the buffers bought nothing; one that
    // costs much more means eviction is throwing away work the user is about to
    // ask for again. Reported, not asserted - the right value is a trade-off,
    // and pinning it here would just freeze today's behavior as correct.
    const revisitLatencyMark = timelineFetchLatency.mark();
    const revisitTiming = await openChatAndTime(page, workspace.agentIds[0]);
    const revisitTimelineFetchMs = timelineFetchLatency.findForAgentSince(
      workspace.agentIds[0],
      revisitLatencyMark,
    );
    await takeResourceSample(page);

    const trend = await readResourceTrend(page);
    const samples = await readResourceSamples(page);
    const report = await readResourceReport(page);

    console.log(
      `\nLoaded-chat walk: ${workspace.agentIds.length} chats of ` +
        `~${seeded!.scale.turnsPerChat * seeded!.scale.itemsPerTurn} items each` +
        (Number.isSafeInteger(MOUNTED_RECENT_ITEMS_OVERRIDE) && MOUNTED_RECENT_ITEMS_OVERRIDE > 0
          ? `, ${MOUNTED_RECENT_ITEMS_OVERRIDE} recent rows mounted`
          : ""),
    );
    console.log(formatSeries("tab selected ms", selectionMs));
    console.log(formatSeries("history ready ms", historyReadyMs));
    console.log(formatSeries("timeline round trip ms", timelineFetchMs));
    console.log(formatSeries("dom.nodes", domNodes));
    console.log(summarize("chat tab selected", selectionMs));
    console.log(summarize("chat history ready", historyReadyMs));
    console.log(
      summarize(
        "timeline round trip",
        timelineFetchMs.filter((value): value is number => value !== null),
      ),
    );
    console.log(
      `  first-chat revisit after cap eviction: selected ${revisitTiming.selectedMs}ms, ` +
        `history ready ${revisitTiming.historyReadyMs}ms, ` +
        `timeline round trip ` +
        (revisitTimelineFetchMs === null ? "not observed" : `${revisitTimelineFetchMs}ms`),
    );
    console.log(formatTrendTable(trend));
    console.log(`\n${report}`);
    if (cpuProfile) console.log(`\n${summarizeCpuProfile(cpuProfile)}`);

    await testInfo.attach("loaded-chat-open-ms", {
      body: JSON.stringify(
        { selectionMs, historyReadyMs, timelineFetchMs, revisitTiming, revisitTimelineFetchMs },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await testInfo.attach("loaded-chat-trend", {
      body: JSON.stringify(trend, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("loaded-chat-report", { body: report, contentType: "text/plain" });
    if (cpuProfile) {
      await testInfo.attach("loaded-chat-cpu-profile", {
        body: JSON.stringify(cpuProfile),
        contentType: "application/json",
      });
    }

    // Same contract as the sibling soak: the only hard assertion is that the
    // instrument produced a usable series. A growth budget guessed in advance
    // would encode today's cost as acceptable.
    expect(samples.length).toBeGreaterThanOrEqual(workspace.agentIds.length);
    expect(trend.all.length).toBeGreaterThan(0);
  });

  // THE headline case. Clicking between workspaces in the sidebar, with both
  // side panels open, is where the slowdown is actually reported - not chat
  // volume on its own. The explorer is open on the Changes tab throughout,
  // because a switch with it open loads a git status and a diff for the incoming
  // workspace, and the corpus dirties every working tree so that is real work
  // rather than an empty list. Measuring this with the explorer closed leaves out
  // most of what the user is waiting for.
  test("switching between loaded workspaces with both panels open", async ({ page }, testInfo) => {
    const seeded = corpus;
    expect(seeded, "corpus was not seeded").not.toBeNull();
    const workspaces = seeded!.projects.flatMap((project) => project.workspaces);
    expect(workspaces.length).toBeGreaterThan(1);

    // Wide enough that the sidebar is pinned rather than an overlay - a compact
    // form factor turns the left panel into a sheet and measures a different UI.
    await page.setViewportSize({ width: 1600, height: 1000 });

    const home = workspaces[0];
    await page.goto(buildHostAgentDetailRoute(getServerId(), home.agentIds[0], home.workspaceId));
    await waitForResourceMonitor(page);
    await expect(page.getByTestId("agent-chat-scroll").first()).toBeVisible({ timeout: 60_000 });

    // Right panel: the explorer, parked on Changes so every subsequent switch
    // pays for a git status and diff.
    const changesTab = page.getByTestId("explorer-sidebar-tab-changes_tree");
    if (!(await changesTab.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Open explorer" }).click();
    }
    await expect(changesTab).toBeVisible({ timeout: 30_000 });
    await changesTab.click();
    // The corpus leaves modified files in every tree, so a populated diff list is
    // the signal that the Changes view is doing work and not sitting empty.
    await expect(page.getByTestId(/^diff-file-\d+$/).first()).toBeVisible({ timeout: 60_000 });

    // Left panel: the workspace list has to be on screen to click through it.
    await expect(page.getByTestId("sidebar-project-list")).toBeVisible({ timeout: 30_000 });

    await resetResourceMonitor(page);
    await page.waitForTimeout(2_000);
    await takeResourceSample(page);

    // Round-robin across every seeded workspace rather than bouncing off one
    // neighbour. With more workspaces than the deck cap this guarantees the LRU
    // path is exercised, and it is the rotation users describe: several projects
    // in play at once, each returned to periodically.
    const switchMs: number[] = [];
    const diffMs: number[] = [];
    const mountedTrees: number[] = [await readMountedWorkspaceTreeCount(page)];
    for (let cycle = 0; cycle < workspaces.length * 2; cycle += 1) {
      const target = workspaces[(cycle + 1) % workspaces.length];
      const startedAt = Date.now();
      await selectWorkspaceInSidebar(page, target.workspaceId);
      await waitForWorkspaceOnScreen(page, target.workspaceId);
      switchMs.push(Date.now() - startedAt);

      // Time to a usable Changes list, measured separately from the switch. The
      // panel paints before its diff lands, so folding the two together would
      // credit the switch with work the user is still waiting on.
      const diffStartedAt = Date.now();
      await expect(page.getByTestId(/^diff-file-\d+$/).first()).toBeVisible({ timeout: 60_000 });
      diffMs.push(Date.now() - diffStartedAt);

      await takeResourceSample(page);
      mountedTrees.push(await readMountedWorkspaceTreeCount(page));
    }

    const trend = await readResourceTrend(page);
    const samples = await readResourceSamples(page);
    const hotspots = await readQueryHotspots(page);
    const report = await readResourceReport(page);

    console.log(
      `\nLoaded-workspace rotation: ${workspaces.length} workspaces, ${switchMs.length} switches`,
    );
    console.log(formatSeries("switch ms", switchMs));
    console.log(formatSeries("diff ms", diffMs));
    console.log(
      formatSeries(
        "switch+diff ms",
        switchMs.map((value, index) => value + (diffMs[index] ?? 0)),
      ),
    );
    console.log(formatSeries("mounted trees", mountedTrees));
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
    console.log(summarize("workspace switch", switchMs));
    console.log(summarize("changes list", diffMs));
    console.log(
      summarize(
        "switch to usable",
        switchMs.map((value, index) => value + (diffMs[index] ?? 0)),
      ),
    );
    console.log(formatTrendTable(trend));
    console.log(`\n${report}`);

    await testInfo.attach("loaded-switch-ms", {
      body: JSON.stringify({ switchMs, diffMs, mountedTrees }, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("loaded-switch-hotspots", {
      body: JSON.stringify(hotspots, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("loaded-switch-report", { body: report, contentType: "text/plain" });

    expect(samples.length).toBeGreaterThanOrEqual(switchMs.length);
    expect(trend.all.length).toBeGreaterThan(0);
  });
});
