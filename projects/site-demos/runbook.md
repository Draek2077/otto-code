# Demo runbook — how to run, author, and debug demo scenarios

Operational playbook for the site-demos pipeline. The charter
([site-demos.md](site-demos.md)) holds the _why_ (principles, catalog, storyboards); this
file holds the _how_. It is written to be executable by any agent without rediscovering
anything: follow the recipes literally, and when a run teaches you something new, add it
to the ledger at the bottom **in the same edit as the fix**.

## 1. Commands

All from the repo root (or `packages/app` for the raw playwright calls):

```bash
# Free scenarios (no tokens). Runs BOTH themes by default (demo-twilight + demo-daylight
# Playwright projects). Filter by file name fragment; omit filters to run all *.demo.ts.
npm run demo -- 04-personalities 05-agent-teams 06-model-picker

# Single-theme, for cheap iteration while authoring (half the runtime/cost of `demo`)
npm run demo:twilight -- 04-personalities
npm run demo:daylight -- 04-personalities

# Real-run scenarios (spends Claude tokens; machine-level Claude auth, NO home fork needed).
# `demo:real` replays BOTH themes = 2x the token cost of one capture — use the
# :twilight/:daylight variants while iterating on a real-run scenario's script.
npm run demo:real -- 07-subagent-track
npm run demo:real:twilight -- 07-subagent-track
npm run demo:real:daylight -- 07-subagent-track

# Stills sweeps (desktop x2 themes + phone + tablet + iOS store shots)
npm run demo:spread          # scripted surfaces only
npm run demo:spread:real     # adds the agent-chat surfaces (one real Claude turn)

# Post-process one scenario's .out into site assets (PNG + MP4/WebM + manifest)
npm run demo:assets -- <scenario-name>-twilight <scenario-name>-daylight
```

- **Windows local runs need Edge**: prefix with `E2E_BROWSER_CHANNEL=msedge` (the raw
  `npx playwright test --config playwright.demo.config.ts --project=demo-twilight <filters>`
  form needs it too).
- Runs are long: first invocation ~7 min (Metro cold), warm ~2 min. Running both themes via
  plain `npm run demo` roughly doubles that (two full test passes, one per project). Run in
  the background and read the log afterwards; never sit on a foreground call.
- Output lands in `packages/app/demo/.out/<scenario>-<theme>/` (`theme` is `twilight` or
  `daylight`) — `shots/NN-name.png` + `manifest.json`. Playwright video lands in
  `test-results/` and is referenced by the manifest. `demo:assets` treats each
  `<scenario>-<theme>` directory as an independent scenario, so site output lands at
  `packages/website/public/demos/<scenario>-twilight/` and `<scenario>-daylight/`.

## 2. Isolation guarantees (why re-runs are always clean)

You never need to "reset" anything between invocations:

1. Every invocation boots a **fresh temp `OTTO_HOME`** (`otto-e2e-home-*`) with its own
   daemon on dynamic ports. The real `~/.otto` and port-6868 daemon are never touched.
2. `materialize.ts` **wipes `%TEMP%\otto-demos\<repo>`** before rebuilding each staged
   repo's git history from the checked-in template — crashed runs and agent edits cannot
   leak forward.
3. Playwright gives each test a fresh browser context — no device-local state leaks.

Within ONE invocation, scenarios share a daemon, so every scenario must clean up in
`afterAll` (see the skeleton below). For pristine asset regeneration, prefer **one
scenario per invocation**.

## 3. Authoring a new scenario — the recipe

One scenario = one feature = one `.demo.ts` file in `packages/app/demo/scenarios/`. The
shots are a numbered tutorial: entry point → configuration → payoff, payoff last.

Skeleton (copy this shape; 04/05/06 are the reference implementations):

```ts
import { expect, test } from "../../e2e/fixtures";
import { applyDemoAppearance } from "../helpers/appearance";
import { DemoRecorder } from "../helpers/capture";
import { demoThemeAppearance, resolveDemoTheme } from "../helpers/theme";
import { beat, humanClick, humanType, resetPacingSeed } from "../helpers/pacing";
import { seedDemoCast, waitForProvidersReady, type DemoCast } from "../staging/cast";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

let workspace: DemoWorkspace;
let cast: DemoCast; // only if the feature involves personalities/teams/pickers

test.beforeAll(async () => {
  workspace = await seedDemoWorkspace({
    template: "pulse-api", // or "mango-storefront"
    originOwner: "pulse-labs", // NEVER a github.com owner
    title: "Rate limiting",
  });
  cast = await seedDemoCast(); // options: { teams: [...], activeTeam: "shipCrew" }
});

test.afterAll(async () => {
  await cast?.cleanup(); // removes seeded people, clears active team
  await workspace?.cleanup(); // removes project, deletes repo
});

test("my feature walkthrough", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000); // 600_000 for real-run scenarios
  resetPacingSeed();
  const theme = resolveDemoTheme(testInfo.project.name); // "twilight" | "daylight"
  await applyDemoAppearance(page, demoThemeAppearance(theme));
  const recorder = await DemoRecorder.start(page, `NN-my-feature-${theme}`);

  // ... steps: humanClick/humanType for on-camera actions, beat(page) to settle,
  // recorder.shot("step-id", "Step title", "One-sentence caption the site shows.");

  await recorder.finish(testInfo);
});
```

Rules that make captures good:

- **State-based waits only** — `expect(locator).toBeVisible({ timeout })`, never bare
  `waitForTimeout` as a correctness mechanism (short `beat()`/`pause()` for visual settle
  is fine AFTER the state wait).
- **`humanClick`/`humanType`** for anything the video should show; raw `.click()` only for
  invisible setup.
- **Fail loudly** — if the app isn't in the state the step describes, the scenario must
  fail, not capture garbage. Re-records are cheap.
- **Shot captions are site copy.** Write them as the tutorial sentence a user reads, not
  as test comments. Titles ≤ ~6 words.
- **Use the software properly: fill every form top-to-bottom before photographing it.**
  A screenshot of a sheet with empty fields and placeholder text is not a tutorial step —
  type a believable name, a believable prompt, select the project/host, THEN open the
  picker or take the shot. The final shot of a form is its completed state (every field
  filled), even if the scenario never submits. Invent realistic values that match the
  staged repos (e.g. "Nightly test sweep" on pulse-api, "Conversion dashboard" on the
  storefront).
- **Review the whole frame, not just the feature.** A demo viewer soaks in the entire
  screenshot; every visible region must pass "is this in a good state? does it make sense
  in context?". Concretely:
  - **Sidebar**: seed BOTH staged repos in every scenario so the workspace list looks
    lived-in, never a single lonely row. The left sidebar is always useful context —
    keep it visible.
  - **Show only what the demo needs.** Panels that don't serve the scenario's story stay
    CLOSED — the explorer included: if the demo isn't about files/diffs, don't open it as
    decoration. An empty new-chat pane behind the composer picker is honest context for
    "starting a chat"; an unrelated file tree is clutter. (The left-sidebar exception
    above is deliberate.)
  - **Chat panes may only show REAL provider content** (locked decision) — a free
    scenario never fakes chat history; the draft state is the correct free-scenario
    backdrop.
  - **Header/toolbar/composer**: check what they display (model trigger, mode, team
    switcher) is consistent with the story the caption tells.
  - **No stray states**: no error banners, no "loading" notes, no leftover confirm
    dialogs, no truncated text at the frame edge that reads as broken.
- **Real-run scenarios** gate on
  `process.env.DEMO_REAL === "1" || Boolean(process.env.E2E_FORK_OTTO_HOME_FROM)` via a
  file-level `test.skip(!REAL, ...)`, create agents through `workspace.client.createAgent`
  (provider `claude`, model `opus` is fine for the create-call; personalities need real
  ids — see ledger), and use prompts that are small, single-outcome, and read-only unless
  the diff IS the story.
- After the scenario passes, **update the charter catalog row** (status → built) and, if
  you learned anything, the ledger below.

### Verification loop (do this every time)

1. Run the scenario (background, log to a file).
2. Read the summary lines (`ok`/`x`) and, on failure, the error block — it names the
   locator and step.
3. **Open the PNGs in `demo/.out/<scenario>-twilight/shots/` AND
   `demo/.out/<scenario>-daylight/shots/` and actually look at them — the whole frame, edge
   to edge, the way a demo viewer would.** Passing is not the bar; the bar is "these
   screenshots teach the feature AND every visible region is in a good, contextually
   sensible state" (no red warnings, no empty pickers or placeholder forms, no black voids
   behind popups, no single-row sidebars, correct theme, content scrolled into frame). Check
   Daylight independently — light-mode contrast/legibility bugs don't show up in a Twilight
   review.
4. Fix, re-run, re-look. Screenshots are the truth; the test's green is only a
   prerequisite.

## 4. Seeded world reference

- **Repos**: `pulse-api` (telemetry API; has vitest tests; carries a deliberate
  out-of-scope TODO in `src/routes/events.js` for suggested-task beats) and
  `mango-storefront` (Vite storefront with staged uncommitted changes for diff
  scenarios). Templates in `demo/staging/templates/`; edit the template, never the
  materialized copy.
- **Cast** (`demo/staging/cast.ts`): Aria (orchestrator/coder/chatter, Opus), Forge
  (coder, Sonnet), Argus (judger/researcher/chatter, Opus), Tempo (scheduler, Haiku),
  Scout (researcher/chatter, Sonnet), Quill (writer/chatter, Sonnet), Muse
  (artificer/chatter, Sonnet). Teams: **Ship Crew** (Aria/Forge/Argus/Tempo), **Research
  Guild** (Scout/Quill/Muse).
- **Starter roster always present** (ships with the product): Atlas, Sage, Vera, Pixel,
  Dash, Sprocket + team "The Otto Crew". They appear in every roster/picker shot — that's
  authentic, embrace it, but never reuse their names.

## 5. Selector map (testids verified working)

| Surface                                 | Selector                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings host Agents section            | `page.goto(buildSettingsHostSectionRoute(getServerId(), "agents"))`                                                                                                                                                                 |
| Personalities card / rows               | `agent-personalities-section`, `agent-personalities-card`, `agent-personality-row-*`, edit via `agent-personality-edit-*`                                                                                                           |
| Personality editor                      | `agent-personality-edit-modal`, tabs via `agent-personality-tabs` + button name (Identity/Personality/Model/Voice), save `agent-personality-save-button`; clean close = Escape (dirty close prompts)                                |
| Teams                                   | `agent-teams-section`, `agent-teams-add-button`, `agent-team-edit-modal`, `agent-team-name-input`, `agent-team-member-<personalityId>`, `agent-team-save-button`, `agent-team-row-<id>`                                             |
| Active-team switcher                    | `active-team-switcher-<serverId>` (app shell sidebar), options inside `combobox-desktop-container`                                                                                                                                  |
| Model/personality picker (ALL surfaces) | trigger `combined-model-selector` (`.filter({ visible: true }).first()`); personality rows `personality-row-<id>`; drill-down group `personality-group-all` (no active team) or `personality-group-team` (team active) — never both |
| Schedules                               | route `buildSchedulesRoute()`; new = `schedules-new` **or** `schedules-empty-new` (empty list)                                                                                                                                      |
| Artifacts                               | route `buildArtifactsRoute()`; new = `artifacts-new` **or** `artifacts-empty-new`; project picker `artifact-project-trigger` (must select before the model picker has models)                                                       |
| Composer                                | `composerLocator(page)` from `e2e/helpers/composer`; ghost prompt = the input's `placeholder` attribute                                                                                                                             |
| Suggested tasks                         | `suggested-tasks-overlay`, rows `suggested-tasks-overlay-row-<taskId>`, caret menu `*-caret`                                                                                                                                        |
| Subagents track                         | `subagents-track-header`, rows `[data-testid^="subagents-track-row-"]` (observed ids are composite — prefix-match, never construct)                                                                                                 |
| Visualizer                              | helpers in `e2e/helpers/visualizer` (`openVisualizerFromHeader`, `visualizerIframe`, chats dropdown); canvas pixels are out of bounds — assert DOM only                                                                             |
| Workspace / explorer / diffs            | `gotoWorkspace(page, id)`, "Open explorer" button, `explorer-tab-files` / `explorer-tab-changes`, `diff-file-0` (+`-body`), `changes-options-menu`                                                                                  |

Prefer reusing `packages/app/e2e/helpers/*` over hand-rolling locators; those helpers
already encode quirks (disabled-until-available personality rows, confirm dialogs, etc.).

## 6. Gotchas ledger

Every entry cost a failed run to learn. Check this list BEFORE writing a scenario; append
to it whenever a run fails for a new reason.

1. **Personality model ids must be real** — `provider: "claude"` with `model: "opus"`
   renders every row disabled ("Model 'opus' is not available"). Use
   `claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5` (source of truth:
   `packages/protocol/src/default-personalities.ts`).
2. **Never reuse starter names** (Atlas, Sage, Vera, Pixel, Dash, Sprocket) — duplicates
   appear side by side in every roster shot. That's why our reviewer is Argus, not Sage.
3. **Active team scoping is strict** — with a team active, pickers show ONLY team members
   (up-front slots + one `personality-group-team` group). The cross-cast role-filter
   story (Tempo in schedules, Muse in artifacts) requires NO active team.
4. **Provider-ready flash** — right after daemon boot every personality row shows a red
   "Provider ... is not ready (loading)" note. Call `waitForProvidersReady(page)` (in
   cast.ts) before any people-surface shot.
5. **Empty-state buttons have different testids** — empty schedules/artifacts lists swap
   `schedules-new`/`artifacts-new` for `schedules-empty-new`/`artifacts-empty-new`. Use
   the `.or()` locator.
6. **Artifact sheet models come from the selected project's host** — open
   `artifact-project-trigger` and select a project first, or the model picker says "No
   models match your search".
7. **`artifact-model-trigger` / `schedule-model-trigger` are inner pointerEvents-none
   labels** — click the wrapping `combined-model-selector`, never those.
8. **Personality names are ≤20-char single-word handles** (letters/digits/-/\_).
9. **Prefill `voiceCues`** on seeded personalities or daemon-side saves route through AI
   cue generation.
10. **Scroll before you shoot** — settings sections render below Otto-tools toggles;
    `scrollIntoViewIfNeeded()` the section you're photographing.
11. **Synthetic origins must not be github.com** (forge layer polls `gh` and shows a red
    banner). Materializer uses `git.demoforge.dev`; keep it.
12. **Panel state persists within a capture session** (explorer open, diff expanded) —
    make surface interactions idempotent: click "Open explorer" only if present, expand a
    diff only if its body is hidden.
13. **The mock provider is off-limits for captured chat content** — conversations in
    shots must be real provider runs (locked decision). Mock is fine for invisible
    plumbing only.
14. **Background `git fetch origin --prune` 500s in the daemon log are harmless** (the
    synthetic origin doesn't exist). Don't chase them.
15. **Visualizer canvas is WebGL** — headless capture may render blank. Check the first
    real take; if blank, run headed. DOM waits only prove the guest booted.
16. **Line-number drift in Playwright summaries can't tell you which spec version ran** —
    when in doubt whether an edit made it into a running invocation, check the shots, not
    the test title.
17. **Empty forms are not demo material** (user feedback 2026-07-18) — early artifact/
    schedule shots were taken with nothing filled in and no project selected, which both
    looked wrong and hid the models list. Fill forms completely, in field order, before
    any shot (see the rule in §3). Corollary: the schedule form's project picker is
    `schedule-project-trigger`; the artifact prompt field is
    `artifact-description-input`.
18. **Twilight + Daylight by default, not Neotokyo** (user decision 2026-07-18) — the
    original proof pass hardcoded `{ darkTheme: "cyberpunk", syntaxTheme: "neotokyo" }` in
    every scenario. That's gone: theme now comes from
    `resolveDemoTheme(testInfo.project.name)` (`demo/helpers/theme.ts`), and
    `DemoRecorder.start` takes a theme-suffixed scenario id
    (`` `04-personalities-${theme}` ``). A new scenario that hardcodes an appearance call or
    an unsuffixed `DemoRecorder.start(page, "NN-...")` will silently capture only one theme
    variant and break the site's dark/light asset pairing — copy the skeleton in §3, don't
    hand-roll the appearance call. Neotokyo is scenario 12-themes' job now, not every
    scenario's backdrop.
19. **A real-run agent needs an explicit unattended `modeId`, or it stalls forever** —
    (hero-shot.demo.ts, 2026-07-18) creating an agent with no `modeId` defaults to Claude's
    "Always Ask" mode; with no client watching to click Approve, the very first edit tool
    call hangs the turn indefinitely (`expect(composer).not.toBeEditable()` timed out at
    120s not because 120s was too short, but because the composer would never have
    disabled — the turn was stuck on a permission prompt no one could answer). Fix:
    `modeId: "dontAsk"` on `createAgent` — the Agent SDK's headless posture
    (`docs/safe-unattended.md`): runs without prompting, denies whatever isn't
    pre-approved instead of stalling. 07/08/09's prompts are read-only ("make no code
    changes") so they never hit this; **any real-run scenario whose prompt edits files
    needs `modeId: "dontAsk"`** (09-composer-intelligence likely has this same latent bug —
    flagged separately, unconfirmed since it's never actually been run).
    Second-order effect: `dontAsk` auto-approves with no round trip, so a small task can
    _finish_ before a "composer is disabled" assertion ever catches it mid-flight. Don't
    gate a shot on "the turn just started" for a real-run scenario — either open the
    surface you want (Visualizer, track header, whatever) shortly after navigation and let
    it show whatever state is genuinely there (running or already idle, both are honest),
    or wait for genuine completion (`waitForFinish`) and shoot the settled state instead.
20. **A personality-bound agent needs `connectPersonalitiesClient()`, not
    `workspace.client`** — the plain seed client's `createAgent` (used by 07/08/09, which
    only need `model`) has no `personality` field. Scenarios that need a specific
    personality (starter-roster or cast) on the created agent must open a
    `PersonalitiesDaemonClient` (same one `cast.ts` uses internally) and pass
    `personality: <id>` there instead.
21. **mango-storefront's Vite dev server needs `--host 127.0.0.1` in launch.json, and a
    materialized repo needs an eager `npm install`** (02-preview-verify, 2026-07-18) — two
    separate blockers hit together the first time any scenario actually started
    mango-storefront's real dev server (earlier scenarios only ever opened the storefront
    tab-less, or used electron-smoke's dependency-free static server): (a)
    `DevServerManager.isPortOpen` (`dev-server-manager.ts`) probes `127.0.0.1` explicitly,
    but Vite 6 with no `--host` flag binds only `[::1]` on at least one real dev machine
    (confirmed: `curl 127.0.0.1:5173` failed, `curl localhost:5173` succeeded, `netstat`
    showed only `[::1]:5173 LISTENING`) — the daemon's readiness poll then never sees the
    server as up and times out at 60s. Fixed at the template level (not a workaround):
    `commits/09-launch-config/.claude/launch.json`'s `runtimeArgs` is now
    `["run", "dev", "--", "--host", "127.0.0.1"]`, forwarded through `npm run dev` to Vite.
    (b) `materialize.ts` never runs a template's own `otto.json` `worktree.setup` — that
    only fires for worktree-creation, not a directly-opened `seedDemoWorkspace` workspace —
    so a freshly materialized repo with its own dev server has no `node_modules`. Any
    real-run scenario that actually starts a templated dev server must `npm install` eagerly
    in `beforeAll` before the Preview button or an agent's `preview_start` call can succeed.
    On Windows this install needs `shell: true` (Node's `execFile("npm.cmd", ...)` throws
    `spawn EINVAL` without it — `DevServerManager.spawnServer` already does this correctly
    for the daemon's own dev-server spawns; test-authored child_process calls need the same).
22. **The unattended (no-human-watching) permission mode id is provider-specific, not a
    universal `"dontAsk"`** (02-preview-verify, 2026-07-18) — `modeId: "dontAsk"` only exists
    for Claude (`DEFAULT_MODES` in `claude/agent.ts`). The openai-compatible provider's mode
    list (`OPENAI_COMPAT_MODES` in `openai-compat-agent.ts`) is `default` / `acceptEdits` /
    `plan` / `bypassPermissions` — no `"dontAsk"` id at all. Passing `modeId: "dontAsk"` to an
    openai-compatible `createAgent` doesn't error; it just fails the provider's
    `VALID_MODE_IDS.has(...)` check and silently falls back to `default` (Always Ask), so the
    first `edit_file` call parks on an unanswered permission prompt forever — confirmed
    empirically (chat showed "How would you like to proceed? Deny / Accept" with no one to
    click it, `waitForFinish` still resolved since the agent was no longer "running", and the
    webview never showed the fix). `bypassPermissions` is openai-compat's only
    `isUnattended: true` mode and is the correct one to use here: unlike Claude's
    bypassPermissions (CLI-level, the daemon can't see or guard it — see
    docs/safe-unattended.md's "never bypassPermissions" rule), openai-compat's entire tool
    loop is daemon-owned, so its own "bypass" just means the daemon's in-process permission
    check auto-allows — every call is still fully visible/logged, not routed around the
    daemon. Any scenario that supports multiple providers needs a small
    `resolveUnattendedModeId(provider)` mapping rather than a hardcoded `"dontAsk"`. Separate,
    smaller finding from the same session: a human-opened preview tab can render stale after
    the agent's own later file edit — observed once (local-AI run) where the agent's finish
    message correctly narrated a successful fix-and-verify but the tab we were also
    screenshotting still showed the pre-fix color, while a Claude/Sonnet run of the exact same
    scenario did show the live update with no extra action. Root cause unconfirmed (Vite
    client-HMR-over-websocket timing in the Electron `<webview>` guest is the leading
    suspect); the cheap, honest fix that resolved it is to click the browser pane's own
    Refresh control (`getByRole("button", { name: "Refresh" })`, no dedicated testID) before
    the payoff shot — the same action a human would take to check the latest state, not a
    manufactured result.

## 7. Definition of done for a scenario

- [ ] Passes locally (`ok` in the summary) with no lint errors on touched files.
- [ ] Every PNG reviewed by eye, **in both `-twilight` and `-daylight` output dirs**: no
      red/broken states, content scrolled into frame, captions read as tutorial copy, and
      Daylight specifically checked for light-mode contrast/legibility issues.
- [ ] Cleans up everything it seeded (people, teams by id AND by name if UI-created,
      projects, repos).
- [ ] Charter catalog row updated (status), storyboard added/adjusted.
- [ ] New learnings appended to the ledger above.
