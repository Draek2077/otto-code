# Iron-out checklist — first-run validation of the new specs

37 new specs (31 T1 + 6 T2) landed unexecuted. This is the consolidated list of known
assumptions to verify on first runs, batch by batch. Work through it with targeted runs, never
the full suite at once, and read **Run mechanics** below before invoking anything. Promote
matrix rows 🟡 → ✅ as specs go green.

**Status:** every T1 batch has run green, and the T2 local-AI tier is now 6/6 green. What is
left is the one scoped `personality-autosubmit-regression` rework, the Windows-only
`git-cta-push-reconcile` limitation, and the deferred vision spec (needs a vision-capable
pinned model) — all detailed below. Sections marked DONE are finished; don't re-run them
looking for work.

## Run order suggestion

1. **T1 batches that touch no daemon config** first (git/changes, files/editor, chat/composer) —
   cheapest signal on selector correctness.
2. **T1 batches that patch daemon config** (personalities/teams, settings/visualizer,
   schedules/runs, permissions/wizard) — verify cleanup leaves the shared daemon clean.
3. **T2 local-AI** (`npm run test:e2e:local-ai`) last — slowest, needs LM Studio (always on;
   preflight verifies).

## Run mechanics (learned on first runs)

- **Invoke Playwright directly, not the npm script, on Windows.** `npm run test:e2e` wraps
  `--project='Desktop Chrome'`; cmd.exe passes the single quotes literally and Playwright sees
  project `'Desktop`. Run from `packages/app`:
  `E2E_BROWSER_CHANNEL=msedge npx playwright test --project="Desktop Chrome" e2e/<spec>.spec.ts`
- **Batch a whole category into ONE invocation.** global-setup boots Metro+daemon+relay once
  (~2 min cold) and all specs in the invocation share it (`workers: 1`). Per-spec invocation
  pays the ~2 min cold-start every time. Cold run ≈ 3–6 min; warm specs after ≈ 5–40 s each.
- **A raised timeout does not cover the `afterEach` budget.** A spec carrying
  `test.describe.configure({ timeout: 120_000 })` _and_ an in-body `test.setTimeout(180_000)`
  still reported "Test timeout of 60000ms exceeded" (the `playwright.config.ts` project value)
  once its cleanup hook ran long — the hook is budgeted separately. Two rules follow: keep each
  test comfortably inside ~60 s (split a long one into several tests rather than stretching the
  timeout), and keep `afterEach` cheap and non-throwing. `--timeout=<ms>` on the CLI does raise
  the ceiling, but treat it as a diagnostic, not a design. See also the `test.setTimeout` note
  in Resolved below for the describe-body case.
- **Always pass `E2E_OUTPUT_DIR` outside `packages/app`.** Playwright's default `outputDir`
  (`test-results/`) lives inside Metro's watched project root. On a re-run over existing
  artifacts, Playwright deleting `.playwright-artifacts-N/traces/resources` makes Metro's
  watcher throw `ENOENT ... watch`, the Expo CLI rethrows, and **the bundler dies mid-run** —
  every subsequent spec then fails with `ERR_CONNECTION_REFUSED` on `page.goto`, which looks
  like a spec bug and is not. `test-results` may also be left `Device or resource busy` so you
  cannot delete it. Diagnosed 2026-07-24; tracked in `projects/remaining-work/remaining-work.md`.
  ```bash
  E2E_OUTPUT_DIR=/tmp/pw-out E2E_BROWSER_CHANNEL=msedge npx playwright test --project="Desktop Chrome" e2e/<spec>.spec.ts
  ```
  `E2E_OUTPUT_DIR` is honored by `playwright.config.ts`, which appends a per-project segment
  (`<root>/desktop-chrome`, `/local-ai`, `/real-provider`).
- **Concurrent runs no longer eat each other's artifacts — but only across _different_
  projects.** Two runs used to share `test-results/`, and since Playwright wipes a test's
  output dir (and its worker's `.playwright-artifacts-N` scratch dir) as that test starts, each
  run deleted the other's in-flight trace/video — surfacing as `ENOENT ... trace.zip` /
  `... .network` instead of the real assertion error. Every project now has its own
  `outputDir`, and `test:e2e:local-ai` / `test:e2e:real` set `E2E_HTML_REPORT_DIR` /
  `E2E_REPORT_DIR` so the tier reports don't overwrite each other either. Two agents on the
  **same** project still collide — give each its own `E2E_OUTPUT_DIR` (plus the two report
  vars), per the bullet above.
- **`test.setTimeout(N)` in a `describe` body does nothing** — the project timeout wins, so a
  spec that "looks like" it has 600 s actually gets the project's 240 s. Use
  `test.describe.configure({ timeout: N })`. All three T2 specs below had a silently ignored
  `setTimeout`.

## Resolved

- ✅ **Shared helper `waitForWorkspaceTabsVisible` was broken** against the current app (the
  inline new-agent tab became a `+` menu). Fixed to assert `workspace-new-tab-menu-trigger`.
  This unblocked ~10 existing specs (changes-commit, diff-row-alignment, workspace-agent-tab-\*,
  etc.) plus every new spec that opens a workspace. **Highest-value fix of the pass.**
- ✅ **Git & Changes batch (4/5 green):** `git-log-tab`, `changes-rollback-file` (both tests),
  `changes-commit-agent-cta`. Fixes applied:
  - git-log-tab: the log opens as a _focused_ tab over the Changes pane (`openTabFocused`), so
    the commit section and log pane can't be visible at once. Restructured to commit first
    (beta left dirty to keep the commit section mounted), then open the log and assert.
  - rollback: git restores blobs with CRLF under Windows `core.autocrlf`; normalized line
    endings in the content check (git porcelain is the autocrlf-aware clean-tree proof).
  - staging semantics: the Changes view **stages selected files** (default all-selected), so
    `git status --porcelain` shows `M ` not ` M`. Relaxed the two specs to assert the change
    persists, not its exact index column. **Observation for the user:** confirm that viewing
    Changes staging dirty files is intended (surprising working-index side effect if not).
  - commit-agent: on a fresh daemon the writer resolves to a built-in default personality
    (Dash · Claude · Haiku), not the seeded mock writer; the confirm cancels so nothing bills.
    Assert the structural dialog text (`/personality \(.+\)/`), not a specific roster winner.

- ✅ **Files/editor batch (5/7 tests green):** all 3 `multi-root-edit-gate` tests,
  `file-tab-mode-bar` surfaces test, `chat-markdown-rendering`. Fixes applied:
  - chat-markdown: the mock renders **each markdown block as a separate `assistant-message`**
    (heading, paragraph, list, mid-paragraph are distinct bubbles). The spec scoped every
    content locator to `assistant-message.first()` (the heading-only bubble) — page-scoped them
    all. Also: Otto's chat headings differentiate by **weight, not font size** (h2 == body size,
    weight ≥ 600), so the "heading larger" assertion was relaxed to `>=` with weight as the real
    check. The stream-complete gate uses `.last()` (end marker lands in the final bubble).

- ✅ **The two "file tab" deferrals were locator bugs, not product bugs** (confirmed by reading
  the failure screenshots — the content rendered correctly). Inactive tabs stay mounted
  (`useMountedTabSet`), so multiple `workspace-file-tab-pane` / `workspace-file-pane` (and their
  nested CM editors) coexist; the helpers matched a hidden background pane. Fixed `helpers/
file-tab.ts` to scope every locator to `:visible`. **Both features work correctly:** per-file
  mode memory does NOT leak across files, and opening a second file while one is dirty works.
- ✅ **Staging question answered:** `commitPaths` runs `git add -A -- <paths>` at **commit
  time** (`packages/server/src/utils/checkout-git.ts`). There is no staged/unstaged toggle in
  the Changes UI — it's a working-tree-changes model that stages on commit, matching the
  "everything staged for simplicity" design. The specs assert the change persists, not its
  index column, so they're robust to it.

- ✅ **Chat/composer batch (10/10 tests green):** `composer-suggestions-history`,
  `chat-file-link-side-open`, `rate-limit-warning-strip`, `tool-display-names` passed as
  written. Only `chat-auto-title` needed a fix: the mock's title responder derives from the
  `<user-prompt>` seed the daemon actually sends, which does not match the isolated
  `deriveMockAutoTitle` mirror (it returned prompt words 4–6, not 1–3). Rewrote the assertion to
  the robust contract — the provisional first-line title is replaced by a 1–3 word title whose
  words are all drawn from the prompt (≤ 40 chars) — instead of pinning exact words. (Minor: the
  now-unused `deriveMockAutoTitle` export remains in `helpers/mock-scenarios.ts`; harmless.)

- ✅ **Chat/composer re-verified 2026-07-24 — now 11/11 green** (the batch grew a second
  `rate-limit-warning-strip` test since the pass above). Every checklist item in the
  "Chat / composer" section below was verified and none of the feared failure modes fired:
  ghost text really does project to the `placeholder` DOM attribute; ArrowUp recall needs no
  `Home` keypress; ESC clear-then-cancel works through the `agent.interrupt` scope; the file
  link resolves with `.first()`. One genuine spec bug, plus two findings worth carrying:
  - **rate-limit strip: the headline names the _resolved provider label_, never "Claude."**
    The spec asserted `"Approaching your Claude 5-hour limit"`; a mock agent renders
    `"Approaching your Mock Load Test 5-hour limit · 85% used · resets 3:30 PM"`. The copy is
    `"Approaching your {{provider}} {{window}} limit"` and
    `composer/rate-limit-warning-track.tsx` deliberately resolves the label per agent (its
    comment says "no hardcoded 'Claude'"), so a custom endpoint shows e.g. "LM Studio". Fixed
    both variants to interpolate the shared `MOCK_PROVIDER_LABEL` from `helpers/personalities.ts`
    — which makes the spec actually cover `resolveProviderLabel` instead of a product name.
  - **`chat-auto-title` is NOT hermetic — it makes a real Claude call.** The spec pins the
    metadata-generation chain to `mock`, but the mock provider has no `generateBareCompletion`,
    so the daemon logs `Structured generation: provider failed, trying next` and then
    `succeeded after fallback` with `provider: "claude"`. The pin is a no-op; the title comes
    from the locally-authenticated Claude CLI. That also explains why the earlier pass found
    the title didn't match the `deriveMockAutoTitle` mirror — the mock never generated it.
    The test passes here only because this machine has Claude auth. Logged in
    `projects/remaining-work/remaining-work.md` (Other) with both the product angle (a pinned
    provider silently re-routes spend) and the harness angle.
  - **A stray `Provider 'mock' does not support tool-less completion` warning in the daemon
    log during auto-title is expected**, not a failure — it is the ladder falling through.

- ✅ **Personalities/teams batch (5/6 tests green):** `agent-teams-prompt-stacking`,
  `personality-live-switch`, `personality-new-chat-apply` passed as written; `agent-teams-switcher`
  and `personalities-settings-crud` fixed. Root cause of the two: the settings sidebar now appends
  a redundant `?hostSection=<section>` query to the URL, breaking the exact-route assertion in the
  shared `openSettingsHostSection` helper (`helpers/settings.ts`). Changed it to assert the
  pathname only — fixes both and any other spec navigating host settings sections.

- ✅ **Permissions/wizard batch (8/8 tests green):** `first-time-wizard` (both), `permission-prompt-roundtrip`
  (both), `safe-unattended-deny-responder` (both) passed as written. `auto-mode-haiku-coercion`
  (both) fixed a trivial label-casing mismatch — the app renders sentence case ("Don't ask",
  "Load test"), the spec asserted title case.

- ✅ **Settings/visualizer batch (6/6 tests green):** `appearance-theme-animations` (both),
  `feature-flag-visualizer-gate`, `visualizer-open-boot`, `visualizer-new-chat-redirect` passed
  as written (the P0 Visualizer boot works). `visualizer-session-lifecycle` fixed: archiving the
  **tab-less** agent B removes it from the mirror (close-session proven), but agent A — the
  session the Visualizer _booted with_ — is anchored by its open chat tab (page↔host mirror) and
  persists after daemon-archive; closing its tab opens an "Archive chat?" confirm rather than
  retiring it. Restructured the test to prove add + close-session via B and drop the fragile
  "archive last → No chats" anchor-session assertion. **Observation for the user (not a bug):**
  the Visualizer's primary/booted session persists on the canvas after the agent is archived via
  the daemon, until its chat tab is closed — confirm that's the intended page↔host mirror model.

- ✅ **Schedules/runs batch (all 4 green):** `daemon-reconnect-banner`, `runs-screen` passed as
  written. `schedule-create-flow` fixed: the schedule form's "Agent Personality or Model" picker
  is the combined drill-down — `model-search-input` only renders **inside a provider view**, so
  `selectScheduleModelByLabel` now drills into the provider group ("Mock Load Test") first, then
  searches/picks the model. `schedule-hidden-runs-promote` passes in ~17 s **in isolation**; its
  earlier 120 s timeout was contamination — `daemon-reconnect-banner` restarts the shared daemon,
  destabilizing the run-heavy hidden-runs test that followed it in the same invocation.
  **Batch-ordering caveat:** run `daemon-reconnect-banner` (and any daemon-restart spec) **last**
  or alone; don't precede run-executing specs with it in one invocation.

- ✅ **T2 local-AI tier works — flagship `openai-compat-loop.local` passes (32 s)** against LM
  Studio (qwen3.6-27b-mtp): live prompt → native tool call → file on disk → change visible. The
  first full run failed **all** specs for one reason: every `*.local.spec.ts` imported `test`/
  `expect` from `@playwright/test` instead of `./fixtures`. The `fixtures.ts` `auto` fixture
  seeds the daemon host into browser localStorage; without it the app sits on the "Connect your
  computer" pairing screen and every assertion fails. Fixed the import in all 6 T2 specs. Run T2
  with `--retries=0` while iterating so a live-inference failure fails once, not twice.

- ✅ **T2 local-AI: 4/6 green** — `openai-compat-loop`, `openai-compat-max-rounds`, and both
  `openai-compat-permissions` tests pass against LM Studio. Permissions fix: `waitForFinish`
  resolves while the agent is parked on a prompt ("permission"), so `respondToPermissionsUntilFinish`
  now waits for a genuinely settled `idle`/`failed` state (via `waitForAgentUpsert`) while draining
  prompts — proving the deny/approve actually completes.

- ✅ **T2 local-AI: 6/6 green — the tier is done.** `openai-compat-compaction`,
  `openai-compat-resume`, and `rewind-flow.openai-compat` all pass (batch of 3 ≈ 2 min of specs
  on a warm model). **The `trace ENOENT` had to be fixed first, and it was the whole story for
  two of the three.** Findings, in the order they mattered:
  - **The ENOENT was a second Playwright run in the same checkout.** A concurrent
    `--project="Desktop Chrome"` batch (another agent) shared `packages/app/test-results/`, and
    each run's per-test output-dir wipe deleted the other's live trace/video — so the reported
    error was `ENOENT ... trace.zip` / `... .network` instead of the assertion. Fixed by giving
    every Playwright project its own `outputDir` and each tier its own report dirs (see **Run
    mechanics**). With artifacts preserved, both remaining diagnoses took one run each.
  - **`rewind-flow.openai-compat` — no spec bug, no product bug. Passes in 7.6 s.** The
    "~10 min timeout" was entirely the contaminated environment above (compounded by the
    Metro-watcher death that the same artifact churn causes). Conversation rewind on
    openai-compat works: the timeline epoch rolls, the transcript empties, and the session
    completes a fresh turn. Left as written apart from the timeout form.
  - **`openai-compat-compaction` — no spec bug, no product bug. Passes in ~42 s.** The original
    `"timeout"` was the spec's own 180 s `waitForFinish` cap (`session.ts` returns
    `status: "timeout"` when the wait deadline trips — it is not a daemon-side turn timeout, as
    the old note claimed), tripped by a first-ever T2 run against a cold LM Studio on a loaded
    machine. Verified separately that the summarizer round-trip itself is healthy: a direct
    `/chat/completions` probe with the real compaction system prompt returns an 872-char summary
    in ~20 s (1431 reasoning tokens), so the "no-op vs. real compaction" question is settled —
    `computeCompactionKeepFromIndex` returns `messages.length` for a short conversation, meaning
    a manual `/compact` always summarizes rather than no-op'ing.
  - **`openai-compat-resume` — a real spec bug, and the old diagnosis was wrong.** The model
    _did_ emit the tool call: both durable-timeline assertions (`write_file`/`completed`, before
    and after the restart) passed, and the replayed `user-message` row rendered. What is missing
    is only the **locator**: on a freshly loaded chat every action is settled, and
    `groupConsecutiveActionItems` (`agent-stream/action-grouping.ts`) folds a run of 2+ settled
    actions into one collapsed `action-group-badge` — the reasoning block plus the `write_file`
    call — so `tool-call-badge` is not in the DOM until the group is expanded. Spec now accepts
    either shape and expands the group when present. **Coverage note:** no spec covered the
    action-group collapse before this; the live-loop spec never asserts a tool row at all.
  - **Bonus harness fix — `restartTestDaemon` hung the Playwright worker.** `child.unref()` left
    the respawned supervisor's piped stdout/stderr as live libuv handles, so the worker never
    exited after the test body finished; `openai-compat-resume` sat idle from ~80 s to the 240 s
    project timeout. Unref'ing the pipes cut the same test to 29.7 s. This is very likely the
    "contamination" seen earlier after `daemon-reconnect-banner`, and it affects every spec that
    calls `restartTestDaemon` (`daemon-reconnect-banner`, `runs-screen`,
    `worktree-restore-after-restart`).

- ✅ **Re-run of the four daemon-config batches (2026-07-24) — all green: 6/6 personalities &
  teams, 6/6 settings/visualizer, 5/5 schedules/runs/reconnect, 8/8 permissions/wizard.** The
  earlier pass recorded these green, but three specs failed on re-run. Two causes, both worth
  knowing:
  - **The settings sidebar was re-split and the specs' section slug went stale.** Personalities
    and teams moved out of the Agents host section into their own **Teams** section
    (`HostTeamsPage`; `HOST_SECTION_SLUGS` now also carries `tools` and `terminals`).
    `agent-teams-switcher` and `personalities-settings-crud` navigated to `"agents"` and found
    nothing. Fixed both, and widened `HostSection` in `helpers/settings.ts` to mirror
    `HOST_SECTION_SLUGS` so the next reorg is a type error rather than a 30 s timeout.
  - **Two specs asserted "reveal on error", which the product deliberately does not do.**
    `disposeScheduleRunWorkspace` is three-way, not two-way: a failed run only earns a visible
    workspace when it **produced transcript content**; a run that dies before doing anything
    (spawn error, **personality unavailable**, immediate provider error) has its hidden
    workspace archived, exactly as `docs/safe-unattended.md` describes. Both specs used a
    missing personality — the canonical content-less failure — as their "reveal" trigger, so
    they were asserting against the documented contract. The `hasContent` gate predates the
    specs (`1ea88d262`, 2026-07-19), so these were wrong from the start, not regressed. Rewrote
    `schedule-hidden-runs-promote` and `safe-unattended-deny-responder` to assert the real
    contract, and proved the reveal path where it IS deterministic: a **kept success**
    (`archiveOnFinish: false`). The with-content promote branch has no mock trigger today (the
    mock cannot stream content and then fail) — tracked as a ❌ row in the coverage matrix.
  - **Reveal is unobservable when the run's cwd is already backed by a visible workspace.**
    `revealScheduleRunWorkspace` _reattaches_ the finished run to the occupying workspace
    instead of revealing a duplicate row, so a schedule pointed at the seeded workspace's own
    directory can never produce a new sidebar row. The reveal test now runs its schedules in
    their own temp repo. Its cleanup drops the project before removing the dir and swallows
    Windows `EBUSY` — a revealed workspace is deliberately still live, so the daemon holds it.
  - `personality-autosubmit-regression` (previously deferred) fixed per its diagnosis and now
    passes: added `addProject` to `NewWorkspaceDaemonClient` plus an `addProjectViaDaemon`
    helper that registers a directory as a project **without** backing it with a workspace, and
    pointed the composer at it with `selectNewWorkspaceProject` before Create.

- ✅ **Daemon-config cleanup verified, not assumed.** Read the config the personalities batch
  left behind (`$E2E_OTTO_HOME/config.json`, under `agents.agentPersonalities` /
  `agents.agentTeams` — note the nesting under `agents`): exactly the 6 seeded built-ins
  (Atlas, Sage, Vera, Pixel, Dash, Sprocket), exactly the one built-in team ("The Otto Crew"),
  `activeTeamId` absent, `metadataGeneration` untouched — no `E2e*` residue after six specs
  shared one daemon. One gap found and closed: `agent-teams-switcher` and
  `agent-teams-prompt-stacking` both set `activeTeamId` and cleared it to `null` on the way out
  rather than restoring what they found. Null happens to be the daemon's seeded default, so
  nothing leaked in practice, but both now capture `getActiveTeamId()` up front and restore it
  **last** — after `removeTeamsById`, which nulls `activeTeamId` as a side effect when it
  removes the active team. Settings/visualizer and wizard specs touch device-local
  localStorage only, which is per-browser-context and cannot leak across specs.

## Known environment limitation (not a bug)

- 🟡 **`git-cta-push-reconcile` — Windows-local only.** The daemon's git file-watcher fails with
  `EPERM: operation not permitted, watch` on Windows, so an **out-of-band** re-dirty is never
  observed and `checkoutRefresh`'s diff push won't reconcile the emptied checkout-status cache.
  On Linux/macOS (and CI) the watcher detects the write and the CTA returns — the spec validates
  the fix there. Left asserting the real behavior with a Windows-noise note in the spec; do NOT
  weaken it to pass on Windows. **Open question for the user:** confirm the EPERM watcher is
  specific to E2E temp dirs and does NOT degrade the packaged Windows app's live Changes updates
  (if it does, that's a real Windows product bug worth its own investigation).

## Cross-cutting risks (check once, first)

- [ ] **Stale helper testIDs**: `helpers/app.ts` references `agent-model-selector` /
      `draft-model-select`, which no longer exist in app source (superseded by
      `combined-model-selector`). Existing specs using those helpers may already be broken or
      falling through `.or()` branches — verify with one legacy spec (e.g.
      `workspace-model-restart.spec.ts`) before blaming new specs.
- [ ] **Protocol dist freshness**: the mock-provider + manifest changes (dontAsk mode, synthetic
      scenarios) require rebuilt protocol declarations — run `npm run build:server` before the
      first session (one agent already rebuilt protocol dist, but rebuild after any pull).
- [ ] **RN-web attribute mapping assumptions**: several specs assert `aria-label`,
      `aria-disabled`, `placeholder`, and `role=link` as the DOM projection of RN props. One
      failure pattern here will repeat across specs — fix the idiom once, sweep all.

## Git & Changes (`git-log-tab`, `changes-rollback-file`, `changes-commit-agent-cta`, `git-cta-push-reconcile`)

- [ ] Split-button CTA `aria-label="Commit"` assertion (switch to role/name if RN-web renders differently).
- [ ] Mock provider snapshot must be `"ready"` for the commit-agent personality dialog variant.
- [ ] `changes-primary-cta` uniqueness at 1400×900 (sidebar copy must not mount).

## Local-AI T2 (`openai-compat-*.local`, `rewind-flow.openai-compat.local`) — DONE, 6/6 green

- [x] `modeId: "bypassPermissions"` is accepted by the provider (all four bypass specs pass).
- [x] Max-rounds `set_daemon_config` rebuild timing — not flaky across runs; no settle needed.
- [x] Rewind trigger hover: hovering the `user-message` **row** works; no need to copy the
      shared helper's inner-text-node hover.
- [x] Model cooperation: `qwen3.6-27b-mtp@q4_k_m` reliably tool-calls on the file-write prompts.
      What is _not_ reliable is where the tool row renders — a settled run collapses into an
      action group (see the T2 entry under **Resolved**).

## Permissions / unattended / wizard — DONE (8/8 green, 2026-07-24)

- [x] Permission card copy ("Bash", "Run a shell command", command string) — matches the render.
- [x] `run.output` denial-text assertion — holds.
- [x] `/setup` route entry is deterministic and `hasCompletedSetupWizard` is localStorage, so the
      restore is per-browser-context and leaves later specs alone.
- [x] `mode-control` count-0 assumption holds on the agent route.
- [x] **New:** the deny-responder spec's second test asserted promote-on-error where the product
      archives (content-less failure) — rewritten; see the Resolved entry.

## Personalities & teams — DONE (6/6 green, 2026-07-24)

- [x] Mock provider is listed enabled/ready in the personality editor's provider Combobox.
- [x] Voice-cue generation never triggers — pre-filled cues do their job, no stalled saves.
- [x] `/new` screen composer renders `combined-model-selector` with the personalities section.
- [x] Team switcher works off the starter team; exact-label option rows inside
      `combobox-desktop-container` are correct.
- [x] **New:** personalities/teams now live under the **Teams** host settings section, not
      Agents; and both team specs had to start restoring `activeTeamId` instead of nulling it.
      See the Resolved entries.

## Chat / composer — DONE (11/11 green, 2026-07-24)

- [x] `placeholder` DOM attribute mapping for ghost text — holds; RN `placeholder` projects
      straight to the DOM attribute and `Tab` clears it.
- [x] History recall needs caret at {0,0} on first ArrowUp — not needed, no `Home` keypress.
- [x] ESC handling depends on `agent.interrupt` keyboard scope focus — works; clear-then-cancel
      both fire from the composer's own focus.
- [x] File-link double `role=link` — `.first()` is correct, no `.last()` needed.
- [x] **New:** the rate-limit strip interpolates the resolved provider label, not "Claude" —
      see the Resolved entry above.

## Settings / visualizer — DONE (6/6 green, 2026-07-24)

- [x] Chats-dropdown `getByRole("dialog")` for the Combobox — correct role.
- [x] Archive-while-dropdown-open re-renders live; no close-reopen poll needed.
- [x] Idle mock agents do register visualizer sessions from snapshots.

## Schedules / runs / reconnect — DONE (5/5 green, 2026-07-24)

- [x] Reconnecting toast is catchable in the kill→relisten window; no split helper needed.
- [x] Hidden-run reveal does reach the browser live — but only when the run's cwd is not already
      backed by a visible workspace (otherwise the daemon reattaches instead of revealing) and
      only when the run earned a reveal (kept success, or a failure with content).
- [x] `personality` is not validated at schedule-create time — the run fails at execution, which
      is what makes it a usable deterministic failure trigger.
- [x] First executing mock schedules in this harness work; `schedule-hidden-runs-promote` is now
      two tests (40 s + 14 s) so neither shares a 60 s budget with the other's ~10 s stream.

## Files / editor / multi-root

- [ ] Chat file-link anchor filter inside `assistant-message`.
- [ ] Outside-project **save** write path is the least-proven assertion.
- [ ] Spacing-rhythm computed-margin walk assumes no unknown wrapper contributes margin.

## Deliberate limitations (not bugs — do not "fix")

- Commit-agent spec cancels at the confirm dialog (writer spawns as internal agent, filtered
  from listings by design).
- Auto→Haiku coercion itself is provider-side and unit-tested; E2E covers the locked-badge
  surface only.
- Visualizer node-graph internals live inside the sandboxed vendor iframe; the host session
  mirror is the sanctioned observable.
- Vision spec deferred until a vision-capable local model is pinned.
