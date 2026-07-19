import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { launchDesktopElectron } from "../../e2e/helpers/electron-app";
import { DESKTOP_CAPTURE_RESOLUTION, DESKTOP_LAYOUT_VIEWPORT } from "../helpers/resolution";
import type { SeedDaemonClient } from "../../e2e/helpers/seed-client";
import { getE2EDaemonPort } from "../../e2e/helpers/daemon-port";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, type DemoThemeName } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, pause, resetPacingSeed } from "../helpers/pacing";
import { resolveDemoProvider } from "../helpers/provider";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 02 — Preview verification (the founding feature): launch config ->
 * dev server -> browser pane -> agent proof. This is the scenario that
 * unblocked itself on the Electron capture lane (electron-smoke.electron.ts
 * proved the plumbing) — the `<webview>`-backed Preview browser pane only has
 * runtime behavior inside Electron, so the plain-Chromium demo pipeline
 * (playwright.demo.config.ts) can never show it. See docs/preview.md.
 *
 * Two distinct capabilities are on screen, deliberately kept apart:
 *  - the human-facing zero-friction Preview button (shots 1-2): one server
 *    configured in .claude/launch.json, not running yet -> click starts it
 *    directly, no bootstrap prompt, no picker (runPreviewFlow).
 *  - the agent's OWN autonomous use of its preview_start/browser_* tools to
 *    verify its own fix (shot 4) — the actual differentiating capability,
 *    not just a human clicking a button.
 *
 * Sequencing decision: the human clicks Preview and the pane is confirmed
 * live BEFORE the real prompt is sent. This was chosen over the alternative
 * (let the agent's own prompt tell it to start the server) for two reasons:
 *  1. It avoids a race where the human's button click and the agent's own
 *     preview_start call both try to spawn the same launch-config server at
 *     once.
 *  2. It keeps shot 1 an honest "genuinely the first start" — if the agent's
 *     tool call had started the server first, the later human click would
 *     just be reusing an already-running server, undercutting the
 *     zero-friction-*start* story shot 1 is supposed to tell.
 *  Once the server is already running, the agent's own `preview_start` call
 *  is a spawn-or-reuse against the exact same launch config — DevServerManager
 *  recognizes it's already up and the agent's browser tools attach to the
 *  same daemon-bound tab the human's click opened (findPreviewServerForUrl
 *  enforces one designated tab per server), so its verification is still
 *  genuine: it's checking the fix against the real running app, it just
 *  didn't have to spawn the process itself.
 */

const REAL = process.env.DEMO_REAL === "1" || Boolean(process.env.E2E_FORK_OTTO_HOME_FROM);
test.skip(
  !REAL,
  "Real-run scenario: run via `cross-env DEMO_REAL=1 npm run demo:electron -- " +
    "02-preview-verify` (Claude/Sonnet 5, the default provider) or " +
    "`npm run demo:electron:real:local-ai -- 02-preview-verify` to opt into the local-AI " +
    "tier explicitly (see demo/helpers/provider.ts).",
);

// Real-run + Electron is the most expensive combination in the pipeline
// (tokens per capture AND Electron boot overhead). Following hero-shot's
// precedent: build and verify Twilight only for the first pass. A Daylight
// take is a manual follow-up — flip this const to "daylight" and rerun
// `npm run demo:electron -- 02-preview-verify` whenever that capture is
// wanted; there's no separate npm script for it yet since the Electron lane
// doesn't have twilight/daylight Playwright projects the way the web lane does.
const THEME: DemoThemeName = "twilight";

const PROMPT =
  "The hero heading is unreadable in dark mode — fix the CSS contrast, then use your " +
  "preview_start and browser tools to open the live preview and take a screenshot " +
  "confirming the heading is readable before you finish.";

/**
 * The unattended (no-human-watching) permission mode is NOT the same id
 * across providers — each provider defines its own mode list, and only
 * Claude happens to call its guarded-unattended mode "dontAsk". The
 * openai-compatible provider's mode list (`OPENAI_COMPAT_MODES` in
 * openai-compat-agent.ts) is `default` / `acceptEdits` / `plan` /
 * `bypassPermissions` — there is no "dontAsk" id at all. Passing
 * `modeId: "dontAsk"` to an openai-compatible agent doesn't error; it just
 * fails `VALID_MODE_IDS.has(...)` and silently falls back to `default`
 * (Always Ask), so the very first `edit_file` call parks on an unanswered
 * permission prompt forever (confirmed empirically — see runbook gotcha).
 * `bypassPermissions` is openai-compat's only `isUnattended: true` mode, and
 * — unlike Claude's CLI-level bypass, which the daemon can't see or guard —
 * openai-compat's tool loop is daemon-owned end to end, so "bypass" here
 * just means the daemon's own in-process permission check auto-allows; every
 * call is still fully visible/logged, not routed around the daemon.
 */
function resolveUnattendedModeId(provider: string): string {
  return provider === "claude" ? "dontAsk" : "bypassPermissions";
}

// The daemon client is untyped JS loaded from dist (see personalities.ts) —
// these two extensions mirror electron-smoke.electron.ts's own
// PreviewCapableClient plus the config get/patch pair personalities.ts uses
// for agentPersonalities/agentTeams (same RPC, different top-level config
// keys: mcp.injectIntoAgents and browserTools.enabled).
interface DemoElectronPreviewClient extends SeedDaemonClient {
  getDaemonConfig(requestId?: string): Promise<{
    requestId: string;
    config: { mcp?: { injectIntoAgents?: boolean }; browserTools?: { enabled?: boolean } };
  }>;
  patchDaemonConfig(
    patch: { mcp?: { injectIntoAgents: boolean }; browserTools?: { enabled: boolean } },
    requestId?: string,
  ): Promise<{ requestId: string; config: unknown }>;
  previewListConfig(cwd: string): Promise<{
    configured: boolean;
    servers: Array<{ name: string; port: number }>;
    runningServers?: Array<{
      serverId: string;
      name: string;
      port: number;
      status: string;
    }>;
  }>;
  previewStop(serverId: string): Promise<{ success: boolean; error?: string | null }>;
}

// Self-contained: Playwright serializes only this function's own source text
// to run inside the Electron window, so it must not reference any
// Node-scoped helper (it wouldn't exist in the browser). Copied from
// electron-smoke.electron.ts rather than imported for that reason.
function hasNavigatedWebview(): boolean {
  const webviews = Array.from(document.querySelectorAll("webview"));
  for (const webview of webviews) {
    const src = webview.getAttribute("src") ?? "";
    if (src.length > 0 && !src.startsWith("about:")) {
      return true;
    }
  }
  return false;
}

const execFileAsync = promisify(execFile);

/**
 * The materializer (staging/materialize.ts) only copies file trees and
 * builds git history — it never runs a template's own otto.json
 * `worktree.setup` (that only fires for worktree-creation, not a
 * directly-opened workspace like seedDemoWorkspace produces). mango-storefront's
 * launch.json runs `npm run dev` (Vite), so without a real install here the
 * Preview button's spawn fails immediately ("vite: command not found" /
 * non-zero exit) for both the human's click and the agent's own preview_start
 * call. Install once, eagerly, before either happens.
 */
async function installStorefrontDeps(cwd: string): Promise<void> {
  // Windows can't execFile a .cmd directly (spawn EINVAL) — npm ships as
  // npm.cmd there, so this needs shell:true (routes through cmd.exe/sh)
  // rather than the `npm.cmd` vs `npm` platform-name branch other scripts in
  // this repo use for plain execFileSync of real .exe/binary targets.
  await execFileAsync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd,
    timeout: 180_000,
    shell: true,
  });
}

let storefront: DemoWorkspace;
let pulseApi: DemoWorkspace;

test.beforeAll(async () => {
  // The one repo the story is about.
  storefront = await seedDemoWorkspace({
    template: "mango-storefront",
    originOwner: "mango-labs",
    title: "Storefront contrast fix",
  });
  // Seeded purely so the sidebar shows both staged repos (whole-frame rule) —
  // never used for an agent run in this scenario.
  pulseApi = await seedDemoWorkspace({
    template: "pulse-api",
    originOwner: "pulse-labs",
    title: "Telemetry tidy-up",
  });
  await installStorefrontDeps(storefront.repo.path);
});

test.afterAll(async () => {
  await storefront?.cleanup();
  await pulseApi?.cleanup();
});

test("preview verification: fix the contrast, prove it in the preview", async () => {
  test.setTimeout(600_000);
  const testInfo = test.info();
  resetPacingSeed();

  const metroPort = Number(process.env.E2E_METRO_PORT);
  const daemonPort = Number(getE2EDaemonPort());
  const serverId = process.env.E2E_SERVER_ID;
  if (!metroPort || !serverId) {
    throw new Error(
      "E2E_METRO_PORT / E2E_SERVER_ID not set — globalSetup must run first (via playwright.demo-electron.config.ts).",
    );
  }

  const client = storefront.client as unknown as DemoElectronPreviewClient;

  // On a fresh daemon (fresh OTTO_HOME, no config.json), Claude Code agents
  // get NO Otto MCP tools at all by default — mcp.injectIntoAgents defaults
  // false, so preview_start/browser_* are never registered regardless of the
  // prompt. browserTools.enabled additionally gates browser_* specifically
  // (preview_* is unconditional on it). Both flip live, no daemon restart,
  // and apply to any agent created after this patch.
  await client.patchDaemonConfig({
    mcp: { injectIntoAgents: true },
    browserTools: { enabled: true },
  });

  let electronHandle: Awaited<ReturnType<typeof launchDesktopElectron>> | null = null;
  let startedPreviewServerId: string | null = null;

  try {
    electronHandle = await launchDesktopElectron({
      metroPort,
      daemonPort,
      serverId,
      // Logical (DIP) window size — the app lays out at a normal laptop
      // density here, not as if on a giant 2560-wide screen (which renders
      // every control tiny). The screenshot still comes out at full QHD via
      // the machine's display scale factor + the targetSize resize below.
      windowSize: DESKTOP_LAYOUT_VIEWPORT,
    });
    const { window } = electronHandle;

    // Registers an addInitScript; takes effect on the next navigation, which
    // is the goto() below — no extra reload needed here.
    await applyDemoAppearance(window, demoThemeAppearance(THEME));
    // targetSize: the real Electron window reflects this machine's actual
    // display scale factor (e.g. 2x on a HiDPI dev box), so a DESKTOP_LAYOUT_VIEWPORT
    // (1024×576 DIP) window screenshots at 2048×1152 on a 2x box, 3072×1728 on a
    // 3x one — DemoRecorder resizes every shot to the exact target, matching the
    // web lane's output pixel-for-pixel regardless of which machine ran it.
    const recorder = await DemoRecorder.start(window, `02-preview-verify-${THEME}`, {
      targetSize: DESKTOP_CAPTURE_RESOLUTION,
    });

    // Create the agent WITHOUT a prompt yet — the human Preview-button flow
    // (shots 1-2) runs first, uncontested (see file header for why).
    // Provider/model are never hardcoded — see demo/helpers/provider.ts.
    // Default is Claude on Sonnet 5 (user decision, 2026-07-18: cheap
    // relative to Opus, full feature set). DEMO_PROVIDER=local-ai opts into
    // the local-AI tier explicitly (the "openai-compatible" provider
    // e2e/global-setup.ts injects when E2E_LOCAL_AI=1). The daemon's MCP
    // tool injection above (mcp.injectIntoAgents / browserTools.enabled) is
    // provider-agnostic, so preview_start/browser_* work the same either way.
    const { provider, model } = resolveDemoProvider();
    const agent = await storefront.client.createAgent({
      provider,
      cwd: storefront.repo.path,
      workspaceId: storefront.workspaceId,
      title: "Storefront contrast fix",
      model,
      // No client is watching to answer permission prompts — the default
      // "Always Ask" mode would stall on the first edit tool call forever.
      // The unattended mode id is provider-specific — see
      // resolveUnattendedModeId's comment above.
      modeId: resolveUnattendedModeId(provider),
    });

    const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, storefront.workspaceId);
    await window.goto(`http://localhost:${metroPort}${agentRoute}`, { timeout: 120_000 });
    await window.waitForURL(
      (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
      { timeout: 60_000 },
    );

    const tabsRow = window.getByTestId("workspace-tabs-row").filter({ visible: true }).first();
    await expect(tabsRow).toBeVisible({ timeout: 30_000 });
    await beat(window);

    // Shot 1: the real Preview button. Exactly one server configured in
    // .claude/launch.json and not running yet -> runPreviewFlow's
    // zero-friction path starts it directly (no bootstrap prompt, no picker).
    const previewButton = window
      .getByTestId("workspace-preview-button")
      .filter({ visible: true })
      .first();
    await expect(previewButton).toBeVisible({ timeout: 30_000 });
    await expect(previewButton).toBeEnabled({ timeout: 30_000 });
    await humanClick(window, previewButton);

    await expect
      .poll(
        async () => {
          const config = await client.previewListConfig(storefront.repo.path);
          const running = config.runningServers?.find((s) => s.status !== "exited");
          if (running) {
            startedPreviewServerId = running.serverId;
          }
          return Boolean(running);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await beat(window);
    await recorder.shot(
      "preview-server-start",
      "One click, dev server up",
      "The Preview button reads mango-storefront's launch config and starts its dev server directly — one server configured, so there's no picker or setup prompt.",
    );

    // Shot 2: wait for the <webview> to actually navigate before shooting —
    // don't capture a spinner.
    await expect(async () => {
      const navigated = await window.evaluate(hasNavigatedWebview);
      expect(navigated).toBe(true);
    }).toPass({ timeout: 60_000 });
    // Let the guest page paint after navigation.
    await window.waitForTimeout(2_000);
    await recorder.shot(
      "preview-pane",
      "The storefront, live in Otto",
      "A real browser tab renders the running dev server inline — the hero heading is still unreadable, the bug the agent is about to fix.",
    );

    // Now the real turn: fix the CSS, then verify with the agent's OWN
    // preview/browser tools. The server is already running, so its own
    // preview_start call is a reuse, not a fresh spawn.
    await storefront.client.sendAgentMessage(agent.id, PROMPT);
    recorder.step(
      "agent-fixes-css",
      "Fixing the contrast",
      "The agent edits the CSS and reloads the preview to check its work.",
    );

    // Non-fatal probe: does the agent's own tool use ever render a visible
    // proof row (preview_start / browser_navigate / browser_screenshot) in
    // the transcript? This is the actual capability being showcased, so it's
    // worth knowing honestly whether it fired — but the scenario must not
    // fake a pass if it doesn't; waitForFinish below is the real completion
    // signal either way.
    const proofBadge = window
      .getByTestId("tool-call-badge")
      .filter({ hasText: /Preview|Browser/i })
      .first();
    const toolProofSeenMidRun = await proofBadge
      .waitFor({ state: "visible", timeout: 240_000 })
      .then(() => true)
      .catch(() => false);
    testInfo.annotations.push({
      type: "preview-tool-proof-mid-run",
      description: String(toolProofSeenMidRun),
    });

    await storefront.client.waitForFinish(agent.id, 480_000);
    await pause(window, 2_500);

    const toolProofVisibleAtFinish = await proofBadge.isVisible().catch(() => false);
    testInfo.annotations.push({
      type: "preview-tool-proof-at-finish",
      description: String(toolProofVisibleAtFinish),
    });

    // The human-opened preview tab may not have picked up Vite's client-side
    // CSS HMR push for an edit the agent made after that tab was already
    // open (observed: the agent's own verification narrated success while
    // this tab still rendered the pre-fix color) — refresh it explicitly,
    // the same action a human would take to check the latest state, before
    // the payoff shot. This is not manufacturing proof: it's checking the
    // real file state through the same UI control a viewer could click.
    const refreshButton = window
      .getByRole("button", { name: "Refresh" })
      .filter({ visible: true })
      .first();
    if (await refreshButton.isVisible().catch(() => false)) {
      await humanClick(window, refreshButton);
      await pause(window, 2_000);
    }

    if (toolProofVisibleAtFinish) {
      // The chat pane auto-scrolls to pin the newest (finish-summary) message
      // at the bottom, which leaves the tool-call badge proving the agent's
      // own preview/browser tool use scrolled just above the visible frame.
      // Center it so the badge and the finish summary below it land in the
      // same shot — the actual tool-driven proof, not just text describing it.
      await proofBadge
        .evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }))
        .catch(() => undefined);
      await pause(window, 800);
    }

    // Shot 4 (the payoff): whatever the transcript genuinely shows once the
    // turn settles — the agent's own tool-driven proof if it fired, or its
    // finish summary either way. Never faked.
    await recorder.shot(
      "preview-proof",
      "Verified, right in the chat",
      "The agent's own preview and browser tools confirm the fix — the proof lands in the conversation, not a manual check.",
    );

    await recorder.finish(testInfo);
  } finally {
    if (startedPreviewServerId) {
      await client.previewStop(startedPreviewServerId).catch(() => undefined);
    }
    if (electronHandle) {
      await electronHandle.close().catch(() => undefined);
    }
    await client
      .patchDaemonConfig({ mcp: { injectIntoAgents: false }, browserTools: { enabled: false } })
      .catch(() => undefined);
  }
});
