# Iron-out checklist — first-run validation of the new specs

37 new specs (31 T1 + 6 T2) are written but have never executed. This is the consolidated list
of known assumptions to verify on first runs, batch by batch. Work through it with targeted
runs (`npm run test:e2e --workspace=@otto-code/app -- e2e/<spec>.spec.ts`), never the full
suite at once. Promote matrix rows 🟡 → ✅ as specs go green.

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

## Remaining T2 (live-model behavior — needs iteration, not clearly spec bugs)

- 🟡 **`openai-compat-compaction`**: after `/compact`, the follow-up turn ends in status
  `"timeout"` (the daemon's turn timeout, not the spec wait) — the 27B local model appears to
  stall on the first post-compaction turn. Needs investigation: is compaction leaving the context
  in a shape the small model struggles with, or does the follow-up prompt need to be trivially
  answerable? Retry against a larger quant to isolate model-capability vs. real bug.
- 🟡 **`openai-compat-resume`**: after the daemon restart, `tool-call-badge` never appears — the
  model likely didn't emit a tool call on the pre-restart turn (the prompt didn't reliably elicit
  one). Tighten the prompt to force a tool call deterministically, or assert on the user prompt +
  assistant text (which do replay) rather than a tool call the model may skip.
- 🟡 **`rewind-flow.openai-compat`**: ran ~10 min and timed out (trace ENOENT masks the real
  failure). The multi-turn rewind flow against the local model is the slowest/most complex T2
  case; needs a focused run with tracing to see where it stalls.

## Deferred (scoped rework, diagnosed)

- 🟡 **`personality-autosubmit-regression`**: screenshot showed the app blocks the new-workspace
  **composer** from creating a second workspace on a directory that already backs one ("This
  directory already backs the workspace 'main'…"). The test opens a project (→ backs "main") and
  the composer defaults to that same directory, so Create is blocked. Same-directory workspaces
  are only creatable via the **daemon API** (`createWorkspace` with `projectId`), not the composer.
  **Fix:** point the composer at a workspace-free project — register a second temp repo as a
  project _without_ a workspace (add `addProject` to `NewWorkspaceDaemonClient`'s Pick and call
  it, or use the personalities client which has it), then `selectNewWorkspaceProject(...)` to it
  before submitting. The `resolveDraftPersonality` assertion itself is sound; only the setup
  targets a blocked directory.

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

## Local-AI T2 (`openai-compat-*.local`, `rewind-flow.openai-compat.local`)

- [ ] Flagship now passes `modeId: "bypassPermissions"` (fixed after the permissions agent found
      the Always-Ask default) — confirm mode id string is accepted by the provider.
- [ ] Max-rounds: `set_daemon_config` assumed to apply the provider rebuild synchronously before
      the next createAgent; add a settle/patch-first if flaky.
- [ ] Rewind trigger hover: hovers the `user-message` row; shared helper hovers inner text node —
      switch if the trigger doesn't appear.
- [ ] Model cooperation: file-write prompts must produce tool calls; `retries: 1` covers
      occasional refusals, but if systematic, tighten prompts.

## Permissions / unattended / wizard

- [ ] Permission card copy ("Bash", "Run a shell command", command string) vs. actual render.
- [ ] `run.output` denial-text assertion (holds for both lastMessage/finalText paths by design).
- [ ] Wizard specs assume `/setup` route entry is deterministic; verify `hasCompletedSetupWizard`
      restore leaves later specs unaffected.
- [ ] `mode-control` count-0 assumes single live composer on the agent route.

## Personalities & teams

- [ ] Mock provider listed as enabled/ready in the personality editor's provider Combobox.
- [ ] Voice-cue generation must never trigger (specs pre-fill cues) — a stalled save points here.
- [ ] `/new` screen composer renders `combined-model-selector` with personalities section.
- [ ] Team switcher relies on starter team ("The Otto Crew") keeping the switcher mounted;
      option rows matched by exact label inside `combobox-desktop-container`.

## Chat / composer

- [ ] `placeholder` DOM attribute mapping for ghost text.
- [ ] History recall needs caret at {0,0} on first ArrowUp (add `Home` keypress if flaky).
- [ ] ESC handling depends on `agent.interrupt` keyboard scope focus.
- [ ] File-link double `role=link` (nested anchor/Pressable): `.first()` may need `.last()`.

## Settings / visualizer

- [ ] Chats-dropdown assertions use `getByRole("dialog")` for the Combobox — verify menu role.
- [ ] Archive-while-dropdown-open assumes live option-list re-render; else close-reopen poll.
- [ ] Idle mock agents must register visualizer sessions from snapshots (grounded in adapter
      source, unobserved live).

## Schedules / runs / reconnect

- [ ] Reconnecting toast must be catchable during the kill→relisten window (split stop/start
      helper if flaky).
- [ ] Hidden-run reveal relies on live `workspace_update` reaching the browser session.
- [ ] `personality` on schedule create assumed not validated at create time (failure lever).
- [ ] First-ever executing mock schedules in this harness (existing specs only seeded them).

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
