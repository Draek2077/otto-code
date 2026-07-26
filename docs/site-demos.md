# Site demos — the capture pipeline

The marketing site's screenshots, videos and store listings are **generated, not hand-made**.
Playwright drives the real app against authentic staged data in an isolated Otto stack, capturing
PNGs and video that land in `packages/website/public/demos/<scenario>-<theme>/` with a
`manifest.json` the site renders as a slideshow or a chaptered video.

Everything lives in `packages/app/demo/`, reusing the e2e harness. It never touches the real
`~/.otto` or the port-6868 daemon.
[`packages/app/demo/README.md`](../packages/app/demo/README.md) is the short operator's version —
how to run what already exists. This page is the durable half: the principles that decide what a
good capture is, the two lanes, the isolation guarantees, and the ledger of things that cost a
failed run to learn.

## One run, one feature

Each demo run showcases **exactly one feature**. A run's screenshots are a step-by-step guide to
using that feature: every `shot()` is one instructional step with a title and a caption the site
renders as a numbered walkthrough.

- Small, focused scenarios beat multi-feature tours. If a scenario wants to show a second feature,
  that is a second scenario — shared seeding makes this cheap.
- Steps are ordered the way a user would discover the feature: **entry point → configuration →
  payoff.** The last shot is always the payoff state.
- Shared staged data (repos, cast) keeps every scenario's world consistent, so screenshots from
  different runs look like one product story.
- **Shot captions are site copy.** Write them as the tutorial sentence a user reads, not as test
  comments. Titles ≤ ~6 words.

### The whole frame is the demo

A viewer soaks in the entire screenshot, so every visible region must pass "is this in a good
state, and does it make sense in context?" — not just the region the feature lives in.

- **Sidebar:** seed **both** staged repos in every scenario so the workspace list looks lived-in,
  never a single lonely row. The left sidebar is always useful context; keep it visible.
- **Show only what the demo needs.** Panels that do not serve the story stay closed — the explorer
  included. An empty new-chat pane behind the composer picker is honest context for "starting a
  chat"; an unrelated file tree is clutter. (The left sidebar is the deliberate exception.)
- **Fill every form top to bottom before photographing it.** A sheet with empty fields and
  placeholder text is not a tutorial step. Type a believable name, a believable prompt, select the
  project and host, _then_ open the picker or take the shot. The final shot of a form is its
  completed state, even if the scenario never submits it. Invent values that match the staged repos
  ("Nightly test sweep" on `pulse-api`, "Conversion dashboard" on the storefront).
- **Chat panes may only show real provider content.** A free scenario never fakes chat history; the
  draft state is the correct free-scenario backdrop. The mock provider is fine for invisible
  plumbing, never for captured conversation.
- **No stray states:** no error banners, no loading notes, no leftover confirm dialogs, no
  truncated text at the frame edge that reads as broken. Header, toolbar and composer must be
  consistent with the story the caption tells.

## Locked decisions

- **Outputs are PNG + MP4/WebM. No GIF.**
- **Desktop capture is 2560×1440 (16:9 QHD).** Dual-pane layouts read better wide, with less
  scrolling in frame. Shared constant: `demo/helpers/resolution.ts`'s
  `DESKTOP_CAPTURE_RESOLUTION`.
- **Twilight (dark) + Daylight (light) are captured by default, for every scenario.** These are the
  site's own default themes, not a special pass, so the site can swap the embedded asset by the
  visitor's own dark/light mode — pick the manifest whose suffix matches. Theme comes from
  `resolveDemoTheme(testInfo.project.name)` (`demo/helpers/theme.ts`); output dirs are
  theme-suffixed, and `demo:assets` treats each as an independent scenario. Neotokyo is reserved
  for the dedicated themes showcase; it stopped being the default backdrop. Store-listing captures
  (Android stock dark, iOS light) follow store convention, not site branding.
- **Bare web app capture; window chrome is the site's job.** The website wraps demo media in CSS
  window framing, so frames can be restyled without re-recording.
- **Generated assets stay out of git.** `packages/website/public/demos/` and `demo/.out/` are
  gitignored and regenerated on demand — safe to delete either at any time.
- **Conversations are real provider runs.** No mock or scripted chat content in a capture. Every
  re-record costs tokens, so scenario prompts stay small and well-scoped, and capture points key on
  **UI state** (status chips, streaming indicators, tool-call rows, finish state), never on fixed
  timings.
- **Real-run scenarios choose provider and model via env vars**, never a hardcoded value in the
  scenario file. `demo/helpers/provider.ts`'s `resolveDemoProvider()` reads `DEMO_PROVIDER`
  (default `claude`) and `DEMO_MODEL` (default Sonnet 5 — cheap relative to Opus, and the only
  provider with the full feature set demo captures need: the openai-compatible tool catalog has no
  TodoWrite equivalent, so planning/todo beats cannot run on it). `DEMO_PROVIDER=local-ai` opts
  into the e2e local-AI tier's injected LM Studio provider, gated on `E2E_LOCAL_AI=1` plus
  `.env.test`.

## Isolation guarantees

You never need to reset anything between invocations:

1. Every invocation boots a **fresh temp `OTTO_HOME`** (`otto-e2e-home-*`) with its own daemon on
   dynamic ports. The real `~/.otto` and its port-6868 daemon are never touched.
2. `materialize.ts` **wipes the staged repo directories** before rebuilding each one's git history
   from the checked-in template, so crashed runs and agent edits cannot leak forward.
3. Playwright gives each test a fresh browser context — no device-local state leaks.

Within one invocation scenarios **share** a daemon, so every scenario cleans up in `afterAll`. For
pristine asset regeneration, prefer one scenario per invocation.

**Never fork the dev home for Claude captures.** `E2E_FORK_OTTO_HOME_FROM` copies the developer's
real projects and agents into the demo daemon, and they pollute the sidebar in screenshots. Claude
auth is machine-level (`~/.claude`), so real Claude turns work unforked — the real-run scripts set
`DEMO_REAL=1` with no fork. Only providers whose auth lives in Otto's own config (openai-compat
endpoints, LM Studio keys) need a fork, and that must come from a curated config-only source home,
never the dev home (`packages/desktop/.dev/otto-home`) directly.

## The two capture lanes

**Web (`*.demo.ts`, `*.spread.ts`)** — Playwright Chromium against the app's web build. The default
lane; it covers chat, settings, personalities, diffs, the Visualizer, everything.

**Electron (`*.electron.ts`)** — the real `packages/desktop` app via Playwright's `_electron`
module. Needed only for what the web build structurally cannot show: the `<webview>`-based Preview
browser pane (Electron-only, see [preview.md](preview.md)) and native OS window chrome. Use
`launchDesktopElectron()` instead of the `page` fixture, and `captureWindowWithChrome()` instead of
`page.screenshot()` when the shot needs OS chrome — a page screenshot can never include it.

Alongside step-by-step scenarios there is a second capture type: **feature spreads**
(`*.spread.ts`) — non-narrative sweeps that jump route to route and photograph surfaces, no video,
no pacing. They back the website's feature sections and the store listings, and surfaces are a
declarative list in the spec, so adding one is a route plus a name.

### Resolution and zoom — the classic mistake

2560×1440 is the **output** pixel size, not the layout size. The app lays out at
`DESKTOP_LAYOUT_VIEWPORT` (1024×576 logical at the default 2.5× scale) and is captured at
`DESKTOP_CAPTURE_SCALE`, so the UI renders large while the PNGs land at full QHD. **Setting the
viewport straight to 2560×1440 with scale 1 makes the app lay out as if on a giant screen and every
control renders tiny.**

The zoom is `DEMO_ZOOM` (logical width = 2560 ÷ zoom), defaulting to 2.5. **The hard ceiling is
≈ 3.0:** below the `md` breakpoint of 768px logical width the app flips to its compact layout and
split panes disappear, and 2560 ÷ 768 ≈ 3.33 — so 3.0 (853px wide) is the biggest zoom that stays a
real desktop layout. `resolution.ts` clamps higher values. Higher zoom also shrinks logical
_height_ (2.5 → 576, 3.0 → 480), leaving tall content less room.

The web lane gets this from the Playwright project's `viewport` + `deviceScaleFactor`. **The
Electron lane cannot** — a real OS window's screenshot reflects the capturing machine's actual
display scale factor, so a window whose content area was set to 2560×1440 can still screenshot
oversized. Electron scenarios therefore pass `windowSize: DESKTOP_LAYOUT_VIEWPORT` to
`launchDesktopElectron()` **and** `targetSize: DESKTOP_CAPTURE_RESOLUTION` to `DemoRecorder.start()`
(or call `resizePngToTarget()` from `e2e/helpers/image.ts` for one-off shots), which resizes every
captured PNG to the exact output size regardless of which machine ran the capture. Both options are
required for any Electron scenario that produces site assets.

**Store-listing aspect ratios are strict.** Play phone/tablet shots must be exactly 9:16 or 16:9
(`spread-mobile` 360×640@3× → 1080×1920; `spread-tablet` 1280×720@2× → 2560×1440); the desktop
viewport is not a Play-valid aspect for phone or tablet listings. App Store 6.7" is `spread-ios`
430×932@3× → 1290×2796. The Play feature graphic (1024×500) and the site's og:image (1200×630)
render from static HTML in `demo/assets/` via `demo:feature-graphic` / `demo:og-image` — headless
Chromium screenshots, no daemon needed.

## The staged world

Two fake-but-real repos, checked in as file templates with **real code**, materialized at capture
time into real git checkouts with authored history (8–15 commits, plausible messages, back-dated
timestamps, a feature branch):

| Repo               | What it is                                                                                                    | Why                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `mango-storefront` | A small Vite + React storefront with a dev-server launch config, plus staged uncommitted working-tree changes | Preview scenarios need a photogenic app the agent can start and verify; diff scenarios run standalone                            |
| `pulse-api`        | A Node telemetry API with routes and vitest tests, carrying a deliberate out-of-scope `TODO`                  | Agent-live and people scenarios need code an agent can meaningfully change and test quickly; the TODO backs suggested-task beats |

Edit the **template**, never the materialized copy. Templates carry `otto.json` with
`worktree.setup` so the "Set up worktree scripts" callout never appears in captures.

**People scenarios share one seeded cast** (`demo/staging/cast.ts`): seven named personalities with
distinct roles, colors, prompts and hand-written voice cues, bound to real Claude model ids, plus
two teams — **Ship Crew** (Aria, Forge, Argus, Tempo) and **Research Guild** (Scout, Quill, Muse).
Roles are deliberately uneven so role-filtered pickers demo visibly: the schedule form offers only
Tempo, artifacts only Muse, chat composers the chatter subset.

**Never reuse the shipped starter roster's names** (Atlas, Sage, Vera, Pixel, Dash, Sprocket, team
"The Otto Crew"). The starter roster appears in every roster and picker shot — that is authentic,
embrace it — but a duplicate name renders side by side with itself and reads as a bug. That is why
the cast's reviewer is Argus, not Sage.

## Authoring a scenario

One scenario = one feature = one file in `demo/scenarios/`. Copy the skeleton in
[`packages/app/demo/README.md`](../packages/app/demo/README.md) and 04/05/06 as reference
implementations, then:

- **State-based waits only** — `expect(locator).toBeVisible({ timeout })`, never a bare
  `waitForTimeout` as a correctness mechanism. A short `beat()` / `pause()` for visual settle is
  fine _after_ the state wait.
- **`humanClick` / `humanType`** for anything the video should show; raw `.click()` only for
  invisible setup.
- **Fail loudly.** If the app is not in the state the step describes, the scenario must fail rather
  than capture garbage. Re-records are cheap.
- **Reuse `packages/app/e2e/helpers/*`** rather than hand-rolling locators — those helpers already
  encode the quirks (disabled-until-available personality rows, confirm dialogs, the Visualizer
  iframe).
- **Real-run scenarios** gate on `DEMO_REAL=1` via a file-level `test.skip`, and use prompts that
  are small, single-outcome and read-only unless the diff _is_ the story.

### The verification loop — do this every time

1. Run the scenario in the background, logging to a file.
2. Read the summary and, on failure, the error block — it names the locator and the step.
3. **Open the PNGs in both the `-twilight` and `-daylight` output dirs and actually look at them,
   edge to edge, the way a viewer would.** Passing is not the bar. The bar is "these screenshots
   teach the feature **and** every visible region is in a good, contextually sensible state" — no
   red warnings, no empty pickers or placeholder forms, no black voids behind popups, no
   single-row sidebars, correct theme, content scrolled into frame. **Check Daylight
   independently:** light-mode contrast and legibility bugs do not show up in a Twilight review.
4. Fix, re-run, re-look. Screenshots are the truth; the test's green is only a prerequisite.

A scenario is done when it passes with no lint errors on touched files, every PNG has been reviewed
by eye in both themes, it cleans up everything it seeded (people, teams by id **and** by name if
UI-created, projects, repos), and anything new it taught you is in the ledger below.

## Gotchas ledger

Every entry cost a failed run to learn. Read it before writing a scenario, and append to it
**in the same edit as the fix**.

**Seeding and data**

1. **Personality model ids must be real.** `provider: "claude"` with `model: "opus"` renders every
   row disabled ("Model 'opus' is not available"). Use the concrete ids from
   `packages/protocol/src/default-personalities.ts`.
2. **Personality names are ≤20-char single-word handles** (letters, digits, `-`, `_`).
3. **Prefill `voiceCues`** on seeded personalities, or daemon-side saves route through AI cue
   generation.
4. **Synthetic origins must not be `github.com`.** The forge layer polls `gh pr view` and its
   failure surfaces as a red banner in the changes panel. The materializer uses
   `git.demoforge.dev`; any remote host still yields an `owner/repo` project display name, since
   `deriveProjectGroupingName` takes the last two path segments.
5. **Background `git fetch origin --prune` failures in the daemon log are harmless** — the
   synthetic origin does not exist. Do not chase them.
6. **A materialized repo has no `node_modules`.** `materialize.ts` does not run a template's own
   `otto.json` `worktree.setup` — that only fires for worktree creation, not a directly-opened
   workspace. Any scenario that actually starts a templated dev server must `npm install` eagerly
   in `beforeAll`. On Windows that install needs `shell: true` (Node's `execFile("npm.cmd", …)`
   throws `spawn EINVAL` without it).
7. **Vite needs an explicit `--host 127.0.0.1`.** `DevServerManager.isPortOpen` probes `127.0.0.1`
   explicitly, but Vite 6 with no `--host` flag binds only `[::1]` on at least one real dev
   machine — the daemon's readiness poll then never sees the server and times out at 60 s. Fixed at
   the template level, in the launch config's `runtimeArgs`.

**Surfaces and selectors**

8. **Active team scoping is strict.** With a team active, pickers show **only** team members. The
   cross-cast role-filter story (Tempo in schedules, Muse in artifacts) requires **no** active team.
9. **Provider-ready flash.** Right after daemon boot every personality row shows a red
   "Provider … is not ready (loading)" note. Call `waitForProvidersReady(page)` before any people
   surface shot.
10. **Empty-state buttons have different testids** — an empty schedules/artifacts list swaps
    `schedules-new` / `artifacts-new` for `schedules-empty-new` / `artifacts-empty-new`. Use an
    `.or()` locator.
11. **The artifact sheet's models come from the selected project's host.** Select a project first,
    or the model picker says "No models match your search".
12. **`artifact-model-trigger` / `schedule-model-trigger` are inner `pointerEvents: none` labels** —
    click the wrapping `combined-model-selector`.
13. **Toolbar controls may live in overflow menus.** `changes-toggle-view-mode` only exists in the
    DOM when pinned; go through `changes-options-menu` (which is a bonus capture anyway).
14. **Scroll before you shoot.** Settings sections render below the Otto-tools toggles;
    `scrollIntoViewIfNeeded()` the section you are photographing.
15. **Panel state persists within a capture session** (explorer open, diff expanded — these are
    device-local). Surface interactions must be idempotent: click "Open explorer" only if present,
    expand a diff only if its body is hidden.
16. **Observed subagent row ids are composite** — prefix-match
    `[data-testid^="subagents-track-row-"]`, never construct one.
17. **The Visualizer canvas is out of bounds.** Assert on DOM only; headless capture of the canvas
    may render blank, so check the first real take and run headed if it is.
18. **Empty forms are not demo material.** Early artifact and schedule shots were taken with
    nothing filled in and no project selected, which both looked wrong and hid the models list.

**Real runs**

19. **A real-run agent needs an explicit unattended `modeId`, or it stalls forever.** With no
    `modeId` the agent defaults to "Always Ask"; with no client watching to click Approve, the
    first edit tool call hangs the turn indefinitely — which presents as a
    "composer is disabled" assertion timing out, not because the timeout was short but because the
    composer would never have disabled. Read-only prompts never hit this; **any real-run scenario
    whose prompt edits files needs one.**
20. **The unattended mode id is provider-specific, not a universal `"dontAsk"`.** `dontAsk` exists
    only for Claude. The openai-compatible provider's modes are `default` / `acceptEdits` / `plan`
    / `bypassPermissions`, and passing `dontAsk` there does not error — it fails the provider's
    valid-id check and **silently falls back to `default`** (Always Ask), so the first `edit_file`
    parks on an unanswered prompt forever. `bypassPermissions` is openai-compat's only
    `isUnattended: true` mode and is the correct choice: unlike Claude's `bypassPermissions` (a
    CLI-level posture the daemon cannot see or guard — see
    [safe-unattended.md](safe-unattended.md)), openai-compat's whole tool loop is daemon-owned, so
    its "bypass" only means the daemon's own in-process permission check auto-allows. Every call
    stays visible and logged. A scenario supporting multiple providers needs a small
    `resolveUnattendedModeId(provider)` mapping rather than a hardcoded id.
21. **Unattended mode can finish before you catch it mid-flight.** Auto-approval has no round trip,
    so a small task can complete before a "the turn just started" assertion fires. Either open the
    surface you want shortly after navigation and let it show whatever state is genuinely there
    (running or already idle — both are honest), or wait for genuine completion and shoot the
    settled state.
22. **A personality-bound agent needs `connectPersonalitiesClient()`, not the plain seed client** —
    the latter's `createAgent` has no `personality` field, so passing one silently does nothing.
23. **A human-opened preview tab can render stale after the agent's own later edit.** Observed once
    on a local-AI run where the finish message correctly narrated a successful fix-and-verify while
    the tab still showed the pre-fix state; a Claude run of the same scenario updated live. Root
    cause unconfirmed (Vite client-HMR-over-websocket timing inside the Electron `<webview>` guest
    is the leading suspect). The honest fix is to click the browser pane's own **Refresh** before
    the payoff shot — the same action a human would take, not a manufactured result.

**Tooling**

24. **Windows local runs need Edge** — prefix `E2E_BROWSER_CHANNEL=msedge`; Chromium is not
    installed by default.
25. **Runs are long and must not be watched.** First invocation ~7 min (Metro cold start), warm
    ~2 min, and capturing both themes roughly doubles it. Run in the background and read the log
    afterwards.
26. **Line-number drift in Playwright summaries cannot tell you which spec version ran.** When in
    doubt whether an edit made it into a running invocation, check the shots, not the test title.
27. **Playwright moves the video after the test**, from `.playwright-artifacts-*` into the test
    output dir as `video.webm`. The manifest records both paths and post-processing tries each.

## Watch for stale brand assets

Two website assets were pre-fork Paseo screenshots, found by inspection rather than by any scenario
run — nothing in the pipeline flags this class of drift automatically, so it is worth a recurring
check. `og-image.png` is now a **pure brand card** (no app screenshot) rendered from
`demo/assets/og-image.html`; `hero-mockup.png` stays a genuine app screenshot, sourced from the
`hero-shot` scenario, because it is presented as literal "here's the app" proof on the competitor
comparison pages.

## Cross-references

- [`packages/app/demo/README.md`](../packages/app/demo/README.md) — commands, the interactive
  `demo:run` menu, output locations, the scenario skeleton
- [testing.md](testing.md) — the Playwright tiers and the e2e harness this pipeline reuses
- [preview.md](preview.md) — why the Preview pane forces the Electron lane
- [safe-unattended.md](safe-unattended.md) — permission modes and the `bypassPermissions` rule
