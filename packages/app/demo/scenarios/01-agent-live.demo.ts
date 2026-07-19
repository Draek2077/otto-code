import { expect, test } from "../../e2e/fixtures";
import { expectAgentIdle, expectTurnCopyButton } from "../../e2e/helpers/agent-stream";
import { scrollAgentChatToBottom } from "../../e2e/helpers/agent-bottom-anchor";
import { composerLocator, expectComposerVisible } from "../../e2e/helpers/composer";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import { openModelPersonalityPicker } from "../../e2e/helpers/personalities";
import { getServerId } from "../../e2e/helpers/server-id";
import { waitForWorkspaceInSidebar } from "../../e2e/helpers/workspace-ui";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { applyDemoAppearance } from "../helpers/appearance";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, humanType, resetPacingSeed } from "../helpers/pacing";
import { resolveDemoProvider } from "../helpers/provider";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 01 — Agent working live (the hero demo, one feature: watching an
 * agent go from a blank composer to a finished diff). Repo: pulse-api.
 * mango-storefront is seeded alongside it purely so the sidebar reads
 * lived-in (whole-frame rule) — this scenario never opens it.
 *
 * The create-agent shot is driven genuinely through the UI (open the
 * workspace, open the model picker, pick a Claude model, type the prompt),
 * but the real turn that produces the later shots is started headlessly via
 * workspace.client.createAgent with modeId: "dontAsk" — the UI's default
 * "Always Ask" mode has no client watching to answer its permission prompt,
 * which would stall the very first edit forever (runbook gotcha 19; the
 * same fix hero-shot and 09-composer-intelligence use). dontAsk is also not
 * user-selectable in any mode picker (docs/safe-unattended.md), so there is
 * no UI path that could create this agent directly — the draft interaction
 * in shot 2 is real UI state, just not the run that follows it.
 *
 * Tool-call rows persist in the chat scrollback once rendered (badges never
 * disappear), so waiting for them stays correct even if the short task
 * finishes before the wait resolves — no race against dontAsk's fast,
 * no-round-trip auto-approval (same non-gating principle as hero-shot).
 *
 * NO DEDICATED TODO-LIST SHOT (capability-driven, not a bug — runbook
 * gotcha has the full record): the original storyboard wanted a separate
 * "agent-todos" shot of Claude's TodoWrite-rendered plan. Seven real runs
 * against this task — bare prompt, a soft nudge, an explicit "call
 * TodoWrite" instruction, that instruction plus thinkingOptionId "high",
 * and a genuinely reshaped 3-deliverable task, tried on BOTH Sonnet 5 (5
 * runs) and Opus 4.8 (2 runs) — never once produced a TodoWrite call. This
 * is a task-size effect specific to dontAsk's fast, no-round-trip turns, not
 * a model-tier or wording problem, so it isn't worth chasing further with
 * real tokens. The reasoning-and-tool-calls shot below stands in for both
 * beats the storyboard originally split in two.
 */

const REAL = process.env.DEMO_REAL === "1" || Boolean(process.env.E2E_FORK_OTTO_HOME_FROM);
test.skip(
  !REAL,
  "Real-run scenario: run via `npm run demo:real` (Claude/Sonnet 5, the default) or " +
    "`DEMO_PROVIDER=local-ai npm run demo:real:local-ai` to capture against local-AI instead.",
);

const PROMPT = "Add a request-rate counter to the /health endpoint and cover it with a test.";

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

test("agent working live walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name);
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  // The completed-turn footer (timestamp, duration, token count) is
  // opacity:0 hover-reveal by default (hideChatMessageDetails: true in
  // use-settings/storage.ts) — Playwright's toBeVisible() still passes on
  // an opacity:0 element, so the "agent-done" shot's token counters were
  // silently absent from the actual pixels despite the assertion passing.
  // Scenario-local override (not touched in the shared appearance.ts
  // helper, which every other scenario also uses) registered after
  // applyDemoAppearance's own addInitScript so it merges on top.
  await page.addInitScript(() => {
    const raw = window.localStorage.getItem("@otto:app-settings");
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.hideChatMessageDetails = false;
    window.localStorage.setItem("@otto:app-settings", JSON.stringify(parsed));
  });
  const recorder = await DemoRecorder.start(page, `01-agent-live-${theme}`);
  const serverId = getServerId();

  // ── Entry point: both projects, lived-in sidebar ──────────────────────────
  await page.goto("/");
  await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
  await waitForWorkspaceInSidebar(page, { serverId, workspaceId: storefront.workspaceId });
  await beat(page);
  await recorder.shot(
    "workspaces",
    "Every project, one sidebar",
    "pulse-api and mango-storefront sit ready in the sidebar before any agent runs.",
  );

  // ── Configuration: new chat, model picked, prompt filled ──────────────────
  await gotoWorkspace(page, workspace.workspaceId);
  await expectComposerVisible(page);

  // Real-run scenarios never default to spending the operator's Claude
  // account — see demo/helpers/provider.ts. DEMO_PROVIDER=local-ai (the
  // default) resolves to the "openai-compatible" provider e2e/global-setup.ts
  // injects for the local-AI tier; DEMO_PROVIDER=claude opts into a real
  // Claude turn explicitly.
  const { provider, model } = resolveDemoProvider();
  // Matches the picker's top-level provider-family label: "Claude" for a
  // real Claude run, or the "OpenAI Compatible" label
  // injectLocalAiProvider() gives the LM Studio profile for a local-AI run.
  const providerLabel = provider === "claude" ? "Claude" : "OpenAI Compatible";
  // Curated display text for the known Claude model aliases (verified
  // against a real run — see file header). The local-AI profile exposes a
  // single pinned model under its provider group, so there's nothing to
  // disambiguate by name there.
  const claudeModelLabels: Record<string, string> = {
    sonnet: "Sonnet 5",
    opus: "Opus 4.8",
    haiku: "Haiku 4.5",
  };

  await openModelPersonalityPicker(page);
  await beat(page);
  // The picker opens on its top-level "all" view, not straight into a single
  // provider family: the shipped starter roster (Atlas, Sprocket, ...) is
  // always present as a "Personalities" section here, even with no cast
  // seeded, so the single-provider bypass never kicks in. Drill into the
  // resolved provider's row explicitly before a model is reachable
  // (confirmed for Claude against a real run's error-context snapshot — the
  // "all" view lists provider rows "Claude (12 models)", "Codex (3 models)",
  // "Mock Load Test (4 models)"; unverified for the injected "OpenAI
  // Compatible" row — confirm against a live local-AI run and adjust if the
  // label or row shape differs).
  const providerRow = page
    .getByTestId("combobox-desktop-container")
    .getByText(providerLabel, { exact: true })
    .first();
  await expect(providerRow).toBeVisible({ timeout: 15_000 });
  await humanClick(page, providerRow);
  await beat(page);

  // Match the exact display text in both branches (also confirms the shot
  // and the real headless run below agree on which model did the work).
  // CORRECTION (measured against a real local-AI run's error-context
  // snapshot): the "OpenAI Compatible" family is NOT a single pinned model —
  // LM Studio lists every loaded model (20+ rows here), each showing its raw
  // id as both label and description. The old `xpath=following::*[1]` guess
  // landed on the header's "Open <provider> settings" gear button instead of
  // a model row (it's the element right after the provider label), which
  // opened a second settings dialog and left the picker open. The pinned
  // E2E_LOCAL_AI_MODEL id (what `model` resolves to for local-ai) is a row
  // like any other, so search for it the same way as the Claude branch.
  const modelOption = page
    .getByTestId("combobox-desktop-container")
    .getByText(provider === "claude" ? (claudeModelLabels[model] ?? model) : model, {
      exact: true,
    })
    .first();
  await expect(modelOption).toBeVisible({ timeout: 15_000 });
  await humanClick(page, modelOption);
  await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible({
    timeout: 10_000,
  });
  await beat(page);

  await humanType(page, composerLocator(page), PROMPT);
  await beat(page);
  await recorder.shot(
    "create-agent",
    "Model picked, prompt ready",
    "Pick the model and write the task — pulse-api's /health route needs a rate counter.",
  );

  // ── The real turn (headless — see file header for why) ────────────────────
  const agent = await workspace.client.createAgent({
    provider,
    cwd: workspace.repo.path,
    workspaceId: workspace.workspaceId,
    model,
    title: "Rate counter",
    modeId: "dontAsk",
    initialPrompt: PROMPT,
  });

  await page.goto(buildHostAgentDetailRoute(serverId, agent.id, workspace.workspaceId));
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
  await beat(page);

  // ── Streaming: reasoning + tool calls, one combined shot ───────────────────
  // No dedicated todo-list beat — see the file header for the measured
  // 7-run record showing dontAsk never calls TodoWrite for this task size.
  const toolCallBadge = page.getByTestId("tool-call-badge").first();
  await expect(toolCallBadge).toBeVisible({ timeout: 240_000 });
  await toolCallBadge.scrollIntoViewIfNeeded();
  await beat(page);
  await recorder.shot(
    "agent-toolcalls",
    "Reasoning and tool calls, live",
    "The agent reasons out loud while every file read and edit renders as its own row in the chat.",
  );

  // ── Payoff: finished, with the diff and token counters ─────────────────────
  await workspace.client.waitForFinish(agent.id, 480_000);
  await expectAgentIdle(page);
  await expectTurnCopyButton(page);
  // The sidebar's diffStat badge (the charter's original plan) depends on
  // workspace-git-observer-service's file watcher notifying a
  // workspace_update; on this machine that watcher fails with EPERM on
  // every run (see every captured daemon log), so checkoutRefresh's forced
  // snapshot never reaches the sidebar even though it succeeds server-side
  // — see runbook gotcha for the full trace. A fixed "Edited N files" text
  // match doesn't work either: the tool-call badge summary is composed
  // per-batch and varies by run ("Edited 2 files" vs "Read 7 files, edited
  // 2 files, ran 2 code searches" vs "Edited a file, searched code, ran a
  // command" — all three seen across real runs). The one signal that's
  // stable across every real run observed: the final summary always links
  // the real files it touched.
  await expect(page.getByRole("link", { name: /\.(js|md)$/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await scrollAgentChatToBottom(page);
  await beat(page);
  await recorder.shot(
    "agent-done",
    "Finished, diff and tokens",
    "A summary, the edited files, and token counters — the change is real and ready to review.",
  );

  await recorder.finish(testInfo);
});
