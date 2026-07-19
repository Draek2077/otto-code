# Site Demos — staged data + scripted capture pipeline

Charter for generating the marketing site's demo assets: authentic staged data (real fake
repos, meaningful workspaces), an isolated Otto stack seeded with that data, and
Playwright-driven scenario scripts that walk real workflows while capturing PNG screenshots
and MP4/WebM video for slideshows and tutorials on otto-code.me.

**Status:** approved 2026-07-11; pipeline + scenario 03 shipped and verified the same day
(`npm run demo` → `npm run demo:assets` produces 7 PNGs + MP4/WebM + manifest for
03-diff-review). Expanded 2026-07-18 into per-feature runs (see "One run, one feature"):
cast seeding + scenarios 04/05/06 (free) built and verified green, 07/08/09 (real-run)
built pending a DEMO_REAL capture pass.

**Executing this project? Read [runbook.md](runbook.md) first.** It is the operational
playbook — commands, isolation guarantees, the scenario-authoring recipe, the verified
selector map, and the gotchas ledger. It is deliberately prescriptive so any agent (or
model tier) can run captures and author scenarios without rediscovering anything; keep it
current in the same edit as any fix it should have prevented.

## One run, one feature (locked 2026-07-18)

Each demo run showcases **exactly one feature**. A run's screenshots are a step-by-step
guide to using that feature — every `shot()` is one instructional step with a title and
caption the site renders as a numbered walkthrough. Consequences:

- Small, focused scenarios beat multi-feature tours. If a scenario wants to show a second
  feature, that's a second scenario (shared seeding makes this cheap).
- Steps are ordered the way a user would discover the feature: entry point → configuration
  → payoff. The last shot is always the payoff state.
- Shared staged data (repos, cast) keeps every scenario's world consistent, so screenshots
  from different runs look like one product story.
- **The whole frame is the demo.** A viewer soaks in the entire screenshot, so every
  visible region must be in a good, contextually sensible state: forms filled top to
  bottom, both staged repos in the sidebar, no loading/error residue — and only the
  panels the story needs (the explorer stays closed unless it's the feature; the left
  sidebar always stays). The runbook's whole-frame rule and checklist are the
  operational form of this.
- The end goal is replacing **all** current website screenshots and the mobile
  slides/animations with these generated assets — desktop passes first, then a mobile pass
  per scenario (see "Mobile passes").

### The demo cast

People-scenarios (personalities, teams, pickers) share one seeded cast
(`demo/staging/cast.ts`): seven named personalities with distinct roles, colors, prompts,
and hand-written voice cues, bound to real Claude model ids (Opus/Sonnet/Haiku mix — an
unknown id renders every row disabled) so pickers look real without a run — plus two teams
built from them. Names must not collide with the shipped starter roster (Atlas, Sage,
Vera, Pixel, Dash, Sprocket / "The Otto Crew"), which shows alongside the cast in
captures:

| Personality | Roles                        | Team           |
| ----------- | ---------------------------- | -------------- |
| Aria        | orchestrator, coder, chatter | Ship Crew      |
| Forge       | coder                        | Ship Crew      |
| Argus       | judger, researcher, chatter  | Ship Crew      |
| Tempo       | scheduler                    | Ship Crew      |
| Scout       | researcher, chatter          | Research Guild |
| Quill       | writer, chatter              | Research Guild |
| Muse        | artificer, chatter           | Research Guild |

Roles are deliberately uneven so role-filtered pickers demo visibly: the schedule form
offers only Tempo, artifacts only Muse, chat composers the chatter subset — and with a
team active, pickers lead with the team section and its "Team's <Role>" slots.

## Learnings from the first shipped scenario (03)

- **Never fork the dev home for Claude captures.** `E2E_FORK_OTTO_HOME_FROM` copies the
  developer's real projects/agents into the demo daemon and they pollute the sidebar in
  screenshots. Claude auth is machine-level (`~/.claude`), so real Claude turns work
  unforked: `demo:real` / `demo:spread:real` set `DEMO_REAL=1` with no fork. Only
  providers whose auth lives in Otto's config (openai-compat endpoints, LM Studio keys)
  will need a fork — use a curated config-only source home for those, never
  `.dev/otto-home` directly.
- **Per-platform capture themes (superseded 2026-07-18 — see Locked decisions):**
  desktop/site assets originally captured Neotokyo only; now every `.demo.ts` and desktop
  `.spread.ts` run captures both Twilight and Daylight by default via
  `demo/helpers/theme.ts`'s `resolveDemoTheme(testInfo.project.name)`. Android phone/tablet
  = stock dark, iOS = light, unchanged (store convention, not site branding). Wired in
  `appearanceForProject()` in the spread spec and per-scenario `applyDemoAppearance` calls.
- **Store-listing aspect ratios are strict.** Play phone/tablet shots must be exactly 9:16
  or 16:9 (spread-mobile 360×640@3x → 1080×1920; spread-tablet 1280×720@2x → 2560×1440);
  the desktop viewport (2560×1440, 16:9) is not a Play-valid aspect for phone/tablet listings
  either — use the dedicated spread projects below. App Store 6.7" =
  spread-ios 430×932@3x → 1290×2796. Feature graphic (1024×500) renders from
  demo/assets/feature-graphic.html via `demo:feature-graphic`.
- **Panel state persists across navigations within a capture session** (explorer
  open/closed, diff expanded paths are device-local). Spread surfaces must be idempotent:
  click "Open explorer" only if present, expand a diff only if its body is hidden
  (`expandFirstDiffIfCollapsed`).
- **Synthetic origins must not be github.com.** The GitHub forge layer polls `gh pr view`
  and its failure surfaces as a red banner in the changes panel. Materializer uses
  `git.demoforge.dev` — any remote host still yields the `owner/repo` project display name
  (`deriveProjectGroupingName` takes the last two path segments). Background
  `git fetch origin --prune` still fails in the daemon log; harmless.
- **Templates carry `otto.json` with `worktree.setup`** so the "Set up worktree scripts"
  callout never appears in captures.
- **The composer reflects `@otto:create-agent-preferences`.** The e2e fixture seeds
  mock/load-test; `applyDemoAppearance` overwrites it (registered later, wins) with
  claude/opus so first frames look real without running anything.
- **Playwright moves the video after the test** from `.playwright-artifacts-*` into the
  test output dir as `video.webm`; the manifest records both paths and postprocess tries
  each.
- **Toolbar controls may live in overflow menus.** `changes-toggle-view-mode` only exists
  in the DOM when pinned; go through `changes-options-menu` (also gives a bonus capture).
- The changes panel intentionally has no commit box — committing lives in the workspace
  header git actions (Commit/Pull/Push/Create PR via `checkout_commit_request`), which is
  its own storyboard beat for the git-flow scenario.

## Locked decisions

- **Outputs:** PNG screenshots (named per step) + MP4/WebM video. No GIF.
- **Desktop capture resolution: 2560×1440, 16:9 (decided 2026-07-18, user preference — dual-pane
  layouts read better wide, less scrolling in the frame).** Replaces the original 1440×900
  (16:10). Shared constant: `demo/helpers/resolution.ts`'s `DESKTOP_CAPTURE_RESOLUTION`, used by
  both lanes:
  - Web lane (`playwright.demo.config.ts`'s `CAPTURE_VIEWPORT`): deterministic, Playwright's
    browser context always renders at exactly this size regardless of the host machine's display
    scaling.
  - Electron lane: NOT deterministic by default — a real OS window's screenshot reflects the
    capturing machine's actual display scale factor (e.g. 2x on a HiDPI box), so a window whose
    content area was set to 2560×1440 can still screenshot oversized. `launchDesktopElectron()`'s
    `windowSize` option sets the real `BrowserWindow`'s content area via `setContentSize`, and
    `DemoRecorder.start()`'s `targetSize` option (or `resizePngToTarget()` directly,
    `e2e/helpers/image.ts`) resizes every captured PNG down to the exact target afterward — so
    Electron-lane output matches the web lane pixel-for-pixel regardless of which machine ran the
    capture. Every `.electron.ts` scenario that produces site assets must pass both options.
- **Twilight (dark) + Daylight (light) captured by default, for every scenario (decided
  2026-07-18).** These are the site's own default themes, not a special pass — every
  `.demo.ts` and desktop `.spread.ts` run produces both variants automatically
  (`demo-twilight`/`demo-daylight` and `spread-twilight`/`spread-daylight` Playwright
  projects; see `demo/helpers/theme.ts`). Output dirs are theme-suffixed
  (`.out/04-personalities-twilight/`, `.out/04-personalities-daylight/`), which
  `demo:assets` treats as independent scenarios — so
  `packages/website/public/demos/<scenario>-twilight/` and `<scenario>-daylight/` land as
  parallel manifests. **This is intended to let the site swap the embedded asset by its own
  dark/light mode**, once real captures replace the current hand-built `HeroMockup`/feature
  sections — pick the manifest whose suffix matches the visitor's active theme. Neotokyo is
  reserved for the dedicated Themes showcase (12-themes); it stopped being the default
  desktop/site capture theme it was in the original proof pass. Store-listing captures
  (Android/iOS) are unchanged — those follow store convention (stock dark / light), not site
  branding. Real-run scenarios (07/08/09) now cost 2× tokens per full capture since both
  themes replay an actual provider turn; use `demo:real:twilight` / `demo:real:daylight` to
  iterate on one theme without paying for both.
- **Bare web app capture; window chrome is the site's job** — the website wraps demo media in
  CSS window framing (titlebar etc.), so frames can be restyled without re-recording.
- **Generated assets stay out of git** — `packages/website/public/demos/` is gitignored and
  regenerated/uploaded as part of site deploy.
- **Staged repo themes:** storefront web app + telemetry API (swappable templates).
- **Conversations are real provider runs** — actual Claude Code (and later other providers)
  working against the staged repos. No mock/scripted chat content. Consequences:
  - Provider auth is forked from `.dev/otto-home` into the isolated demo home
    (same `E2E_FORK_OTTO_HOME_FROM` mechanism the real-provider e2e suite uses).
  - Every re-record costs tokens; scenario prompts are kept small and well-scoped.
  - Capture points key on UI state (status chips, streaming indicators, tool-call rows,
    finish state), never fixed timings.
- **Real-run scenarios choose provider/model via env vars, never a hardcoded value in the
  scenario file (locked 2026-07-18).** `demo/helpers/provider.ts`'s `resolveDemoProvider()` —
  `DEMO_PROVIDER` defaults to `"claude"` on Sonnet 5 (user decision, same day: cheap relative to
  Opus, and the only provider with the full feature set demo captures need — the
  local-AI/openai-compatible tool catalog has no TodoWrite-equivalent, so planning/todo beats
  can't run on it, confirmed against `01-agent-live`'s build). `DEMO_PROVIDER=local-ai` opts into
  the e2e local-AI tier's injected LM Studio/Qwen `"openai-compatible"` provider instead (gated
  on `E2E_LOCAL_AI=1` + `.env.test`). See `demo/README.md`'s "Choosing a provider for real-run
  scenarios". `01-agent-live` and `02-preview-verify` use this; `hero-shot`,
  `07-subagent-track`, `08-visualizer`, and `09-composer-intelligence` predate it and still
  hardcode `provider: "claude"` directly — functionally the same default, just not routed
  through `resolveDemoProvider()`; migrating them is a known follow-up.
- **Proof-pass scenarios (in order):** agent working live, preview verification,
  diff review + git flow, multi-agent / personalities.

## Architecture

Everything lives in `packages/app/demo/` with its own Playwright config, reusing the e2e
harness — never touching the real `~/.otto` or the port-6868 daemon.

```
packages/app/
  demo/
    playwright.demo.config.ts     # video always on, 1 worker, no retries, demo testDir
    global-setup.ts               # thin wrapper over e2e/global-setup.ts with demo env
    staging/
      templates/                  # fake project file trees (real code, checked in)
        mango-storefront/         # Vite + React storefront; has launch config for preview
        pulse-api/                # Fastify/Express telemetry API with tests
      materialize.ts              # template → temp dir, git init, authored commit history,
                                  # feature branch, deliberate uncommitted changes
      seed.ts                     # register projects/workspaces/agents/personalities/
                                  # schedules over the daemon WS (via e2e seed-client)
      cast.ts                     # the shared demo cast: named personalities + teams
    helpers/
      capture.ts                  # shot(page, name), step() manifest recorder
      theme.ts                    # resolveDemoTheme(projectName) — twilight/daylight presets
      pacing.ts                   # humanType/humanClick/pause — natural cadence for video
    scenarios/
      03-diff-review.demo.ts        # shipped
      04-personalities.demo.ts      # free, cast-seeded
      05-agent-teams.demo.ts        # free, cast-seeded
      06-model-picker.demo.ts       # free, cast-seeded
      07-subagent-track.demo.ts     # real-run (DEMO_REAL=1)
      08-visualizer.demo.ts         # real-run (DEMO_REAL=1)
      09-composer-intelligence.demo.ts # real-run (DEMO_REAL=1)
      hero-shot.demo.ts             # real-run — flagship still, og-image + hero-mockup source
      feature-spread.spread.ts      # stills sweep (see Feature spreads)
    assets/
      feature-graphic.html          # Play Store feature graphic (static HTML render)
      og-image.html                 # site og:image / twitter:image (static HTML render)
    scripts/
      postprocess.mjs               # ffmpeg: webm → mp4 + webm, trim per manifest timestamps
      feature-graphic.mjs           # renders feature-graphic.html → demos/brand/*.png
      og-image.mjs                  # renders og-image.html → website/public/og-image.png
```

Run: `npm run demo -- --scenario 01-agent-live` (wrapper that boots the stack, runs one
scenario, post-processes, and drops assets + manifest into the output dir).

### Staged repos (the "authentic data")

Fake but believable projects, checked into the repo as file templates with **real code**,
materialized at capture time into real git checkouts:

| Repo               | What it is                                                                                                           | Why                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mango-storefront` | Small Vite + React e-commerce storefront (hero, product grid, cart badge, dark mode) with a dev-server launch config | Preview scenario needs a photogenic web app the agent can start and verify                         |
| `pulse-api`        | Node telemetry/metrics API with routes + vitest tests                                                                | Agent-live and personalities scenarios need code an agent can meaningfully change and test quickly |

Each gets authored git history (8–15 commits with plausible messages and back-dated
timestamps, a feature branch, and — for `mango-storefront` — a set of uncommitted working-tree
changes so the diff scenario is runnable standalone without an agent run first).

### Data flow

1. `materialize.ts` writes both repos to a stable temp root and builds their git history.
2. Demo global-setup boots relay + daemon (fresh temp `OTTO_HOME`, provider auth forked from
   `.dev/otto-home`) + Expo web on dynamic ports.
3. `seed.ts` registers the repos as projects, creates workspaces (nice titles, real branches),
   and writes personalities/schedules into daemon config so every surface has content.
4. Client-side layout (tabs) is device-local, not daemon state — scenarios either open tabs
   on camera (tutorial value) or pre-inject browser storage for "already arranged" screenshots.
5. Scenario script drives the UI with human pacing; `shot()` captures PNGs at named steps and
   records step timestamps; Playwright records webm continuously.
6. Post-process: ffmpeg transcodes/trims per manifest; assets land in
   `packages/website/public/demos/<scenario>/` with `manifest.json`
   (`steps: [{name, title, caption, screenshot, tStart, tEnd}]`) so the site can render
   slideshows or chaptered video without hardcoding.

### Capture presets

- Desktop 2560×1440 (16:9 QHD, decided 2026-07-18 — see Locked decisions), Twilight (dark) and
  Daylight (light), both captured by default per scenario. This is the highest-quality source
  resolution the pipeline captures at; site delivery downscales from here.
- Mobile 390×844 is a later pass over the same scenarios (a preset, not a rewrite) — see
  "Mobile passes".

## Storyboards (proof pass)

### 01 — Agent working live (hero demo)

Repo: `pulse-api`. Prompt (typed on camera, human-paced):
_"Add a request-rate counter to the /health endpoint and cover it with a test."_

1. Workspace list with both staged projects — `shot: workspaces`
2. Open pulse-api workspace → new agent, pick Claude Code + model — `shot: create-agent`
3. Type + send the prompt — video-only beat
4. Streaming: reasoning + todo list appears — `shot: agent-todos`
5. Tool calls: file reads/edits render as rows — `shot: agent-toolcalls`
6. Finish: summary message, diff stat, token counters — `shot: agent-done`

### 02 — Preview verification (founding feature)

Repo: `mango-storefront`. Prompt:
_"The hero heading is unreadable in dark mode — fix the contrast and verify it in the preview."_

1. Agent starts the dev server from the launch config — `shot: preview-server-start`
2. Browser pane opens the storefront — `shot: preview-pane`
3. Agent inspects, edits the CSS, reloads — video beat
4. Verified result + agent's proof (screenshot/console-clean) in chat — `shot: preview-proof`

### 03 — Diff review + git flow (IDE surfaces)

Repo: `mango-storefront` with pre-staged uncommitted changes (standalone; no agent run needed).

1. File explorer tree open — `shot: file-explorer`
2. Changed-files view → open a diff — `shot: diff-view`
3. Scroll hunks, open a second file split — `shot: diff-split`
4. Commit panel: message, commit — `shot: commit`

### 04 — Multi-agent / personalities

Repo: `pulse-api`. Seeded personality team (e.g. an orchestrator + reviewer). Prompt to the
orchestrator: _"Use two subagents in parallel to audit the API routes and the test coverage,
then summarize."_

1. Personality picker on the create form — `shot: personalities`
2. Orchestrator running; subagent rows appear in the track — `shot: subagent-track`
3. Open a subagent's read-only view — `shot: subagent-view`
4. Orchestrator's final synthesis — `shot: orchestrator-summary`

## Scenario catalog (reworked 2026-07-18, one feature per run)

Tiered by capture cost: **free** scenarios run scripted with no agent tokens and are cheap
to re-record; **real-run** scenarios execute an actual provider and go through
`npm run demo:real`. Staged-data opportunities are called out — artifacts and schedules
persist as files the seeder can plant, so those surfaces demo populated without any run.

| id                       | Feature shown                                                                                                      | Cost     | Status      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------- | ----------- |
| 03-diff-review           | File explorer, file tabs, changes list, diff views                                                                 | free     | **shipped** |
| 04-personalities         | Browsing personalities: settings roster, tabbed editor (identity/prompt/model/voice), composer picker selection    | free     | **built**   |
| 05-agent-teams           | Team creation, active-team switcher, team dynamics ("Team's <Role>" slots leading the picker)                      | free     | **built**   |
| 06-model-picker          | One combined model/personality picker across chats, schedules, and artifacts                                       | free     | **built**   |
| 07-subagent-track        | Sub-agent tracking: orchestrator fans out Task subagents → read-only track rows → synthesis                        | real-run | built¹      |
| 08-visualizer            | Visualizer: live agent constellation during a real run, node detail card, chats toolbar                            | real-run | built¹      |
| 09-composer-intelligence | Ghost prompts (Tab-accepted suggestion) + suggested-task chips (spawn_task)                                        | real-run | built¹      |
| hero-shot                | Flagship "everything at once" still: chat + Visualizer split, Atlas (starter roster) on a real turn                | real-run | **shipped** |
| 01-agent-live            | Create agent, streaming, tool calls, todos, finish + diff stat                                                     | real-run | storyboard  |
| 02-preview-verify        | Launch config → dev server → browser pane → agent proof                                                            | real-run | **built**   |
| 10-diff-ai-review        | Inline comment on a diff line → agent applies the fix live → diff updates → header Commit                          | real-run | storyboard  |
| 11-homepage-tour         | Home surface: workspace list, History, Schedules, Artifacts nav, new-workspace entry                               | free     | idea        |
| 12-themes                | Theme system: appearance settings, dark ↔ light, syntax themes — same workspace re-captured per theme              | free     | idea        |
| 13-artifacts             | Artifacts gallery + artifact tab; seeder plants `.otto/artifacts/*.json+html` in the staged repo so it's populated | free²    | idea        |
| 14-schedules             | Schedule form (the golden form), schedules list; seeder plants `schedules/*.json` in the demo home                 | free     | idea        |
| 15-workspace-layouts     | Split panes, agent + terminal + file + browser side by side, tab drag, file mode bar (editor/split/preview)        | free     | idea        |
| 16-terminals             | Terminal tabs, splits, activity indicators while commands run                                                      | free     | backlog     |
| 17-multi-provider        | Provider picker: Claude Code / Codex / OpenCode / LM Studio local — the fork's core pitch                          | free³    | backlog     |
| 18-worktrees             | Branch-off workspace creation, isolated worktree, setup scripts                                                    | free     | backlog     |
| 19-editor-ide            | CM6 editing, split/preview mode bar, project search, file finder                                                   | free     | backlog     |

¹ spec written against the e2e selector helpers; needs a `npm run demo:real` capture pass
to validate the non-deterministic beats before assets ship. **09-composer-intelligence
(validated 2026-07-18):** the missing `modeId: "dontAsk"` permission-stall bug (same class as
hero-shot's) is fixed and confirmed — 2 real runs both completed the turn instead of hanging.
But both runs also failed to trigger `spawn_task`, so the task-chip beat never fired; this
looks like more than ordinary non-determinism, since the out-of-scope TODO lives in
`routes/events.js` while the prompt scopes the agent to `routes/health.js` — the agent may
never read the file with the bug. Before spending more real-run tokens on retries, consider
narrowing the prompt to nudge the agent toward reading the routes directory, or moving the
deliberate TODO somewhere the health-route work naturally touches.
² free if seeded; a real-run variant shows an agent _creating_ an artifact.
³ picker/UI only; running a local model live would need LM Studio reachable at capture time.

### Storyboards — the people features (04/05/06, free)

All three seed the demo cast (see "The demo cast") and run without any provider tokens.

**04-personalities** — how you browse and shape a personality:
roster in host settings → open Aria's tabbed editor → Identity (name/roles/colors) →
Personality (system prompt) → Model (provider/model binding) → Voice (cue lines) → then the
payoff: the composer picker listing the cast, pick Aria, the trigger wears her name.

**05-agent-teams** — team creation and what a team changes:
teams list in settings → create "Ship Crew" in the editor, ticking members → saved row with
member avatars → sidebar active-team switcher → activate Ship Crew → payoff: the workspace
composer picker now leads with the Ship Crew section and its role slots.

**06-model-picker** — one picker, every surface:
workspace composer picker open (providers/models + personality groups) → schedules screen,
new-schedule form, same picker filtered to scheduler-role (Tempo) → artifacts screen, new
artifact, same picker filtered to artificer-role (Muse). Caption thread: "the same picker,
role-aware on every surface."

### Storyboards — the live features (07/08/09, real-run)

**07-subagent-track** — repo `pulse-api`. Prompt asks Claude to audit routes + tests with
two parallel Task subagents. Steps: prompt sent → subagents track header appears with rows
spawning → row liveness (elapsed/tool) → open one subagent's read-only view → orchestrator
synthesis with the track settled.

**08-visualizer** — repo `pulse-api`. Open the Visualizer tab from the workspace header
while a real run streams. Steps: header entry point → constellation with the agent node
active → node detail card (task/cost/tokens) → chats toolbar dropdown → settled idle state.

**09-composer-intelligence** — repo `pulse-api` (template carries a deliberate,
out-of-scope `TODO` so the agent has something honest to flag). One short real turn ends →
ghost-text suggestion appears as the composer placeholder → Tab accepts it into the draft →
suggested-task chip renders above the composer → chip's spawn affordance.

### Site brand assets (fixed 2026-07-18)

Two website assets were stale pre-fork Paseo screenshots, discovered by inspection rather
than by a scenario run — worth a recurring check since nothing in the pipeline flags this
kind of drift automatically:

- **`packages/website/public/og-image.png`** (og:image / twitter:image, the social-preview
  card) showed the Paseo logo and a Paseo screenshot. Replaced with a **pure brand card**
  (no app screenshot) in the style the wizard's brand bookends already use (dual
  indigo/teal glow, faint masked grid, Otto glyph centered on a blurred plasma-ring halo —
  see `wizard-brand-backdrop.tsx` + `welcome-step.tsx`/`done-step.tsx`). Static HTML render,
  same pattern as `feature-graphic.mjs`: `demo/assets/og-image.html` →
  `npm run demo:og-image` → `demo/scripts/og-image.mjs` renders it at exactly 1200×630 (the
  OG standard) via a headless Chromium screenshot, straight into
  `packages/website/public/og-image.png`. No daemon needed.
- **`packages/website/public/hero-mockup.png`** (embedded via `![Otto desktop and mobile
app](/hero-mockup.png)` in all 7 `packages/website/src/content/alternatives/*.md`
  competitor-comparison pages) was a real but unrebranded Paseo screenshot (getpaseo/paseo
  repo names, old provider labels). Replaced with the **hero-shot** scenario's real capture
  — see below. Unlike og-image, this one stays a genuine app screenshot: it's presented as
  literal "here's the app" proof on those pages, not a brand card.

**`demo/scenarios/hero-shot.demo.ts`** — the flagship "everything at once" still, not a
feature tutorial (no numbered walkthrough, one shot). Real-run, `pulse-api` +
`mango-storefront` seeded (whole-frame rule). Creates the agent as the **shipped starter
personality Atlas** (`personality_builtin_atlas`, via `connectPersonalitiesClient()`'s
`personality` field) — not the demo cast, since this is the site's default "meet your
agent" moment. Prompt: the same hero prompt as storyboard 01 ("Add a request-rate counter
to the /health endpoint and cover it with a test."). Once the turn is visibly underway
(composer disabled), opens the Visualizer from the header —
`openVisualizerTab`/`openVisualizerFromHeader` auto-splits to the right of the focused pane
whenever that pane has a companion tab (see `src/visualizer/open-visualizer-tab.ts`), so
chat-then-Visualizer produces the side-by-side split with no explicit split-pane call.
Ran once on `demo-twilight` only (real-run scenarios cost tokens per theme; Daylight capture
is a `npm run demo:real:daylight -- hero-shot` away whenever it's wanted).

## Feature spreads (stills, not stories)

Alongside step-by-step scenarios there is a second capture type: **feature spreads** —
non-narrative sweeps that jump route-to-route and photograph surfaces (no video, no
pacing). Used for the website's feature sections and the Android/Play Store listing.

- `demo/scenarios/feature-spread.spread.ts`, run by two Playwright projects:
  - `spread` — desktop 1440×900.
  - `spread-mobile` — 390×844 at deviceScaleFactor 3 → 1170×2532 portrait PNGs,
    Play-Store-ready.
- `npm run demo:spread` covers home, workspace + open diff (desktop only), appearance +
  general settings, host agent settings, providers. `npm run demo:spread:real` adds the
  agent-chat surface by running one short real Claude turn on pulse-api first.
- Surfaces are a declarative list in the spec — adding one is a route + a name.
- Backlog surfaces to add as their data gets seeded: artifacts gallery, schedules list,
  workspace split layouts, terminals, personalities picker, history.

## Mobile passes

Mobile has the same feature set (sometimes more limited) and showing the same workflows at
phone size is part of the pitch. The approach mirrors the spread projects: a
`demo-mobile` Playwright project re-runs mobile-safe scenarios at the phone viewport
(360×640@3x, stock dark per the platform-theme decision) rather than forking the specs.
Rules:

- A scenario opts in via a `MOBILE_SAFE` export (or an in-test viewport check) once its
  selectors are verified against the compact layout — mobile navigation differs (sheets
  instead of popovers, tab switcher instead of side-by-side panes), so each scenario gets
  one explicit mobile-verification pass before the project includes it.
- Desktop-only beats (split diff, side-by-side panes) are skipped, not simulated.
- The captured steps become the store-listing/mobile-slides material, replacing the current
  hand-made mobile slides and animations.

## Replacing the current site + store assets (the end goal)

Every screenshot on otto-code.me and every mobile slide/animation gets regenerated from
this pipeline. Working inventory:

- Website feature sections — from feature spreads + per-feature scenario payoffs.
- Website hero / tutorial media — from scenario videos (MP4/WebM + chaptered manifests).
- Play Store phone/tablet + App Store shots — from spread-mobile / spread-tablet /
  spread-ios (aspect-ratio rules in Learnings).
- Mobile slides/animations — from the mobile passes above.

The site consumes `manifest.json` per scenario, so slideshows/step-guides update by
re-running capture — no hand-cropping.

## Non-determinism playbook (real runs)

- Prompts are small, single-outcome tasks; the staged code is written so the "right" fix is
  obvious and fast.
- All waits are state-based with generous budgets; a scenario that ends in the wrong state
  fails loudly instead of capturing garbage.
- Re-record is per-scenario, cheap to invoke; the manifest makes partial retakes (screenshots
  only, video only) possible.
- Screenshots of _finished_ states are stable even when the mid-run token stream varies.

## Open questions

1. ~~Dark-only for the proof pass, or dark + light from the start?~~ **Resolved
   2026-07-18: dark (Twilight) + light (Daylight) from the start, by default, for every
   scenario.** See Locked decisions.
2. Should video show the bare web app, or do we want desktop-window framing (fake titlebar /
   device frame) added in post for the site?
3. Output location `packages/website/public/demos/` — commit the binaries to the repo, or
   keep them out of git and upload as part of site deploy?
4. Repo names/content above are proposals — happy to swap themes (storefront/API) for
   anything closer to the story you want the site to tell.

## Build sequence (once approved)

1. Staged repo templates + materializer (verifiable standalone: real repos with history).
2. Demo Playwright project + seeder + capture/pacing helpers.
3. Scenario 03 (diff review) first — no agent run, proves the whole pipeline end-to-end.
4. Scenario 01, then 02, then 04 (each adds one new dependency: real agent run → preview →
   personalities/subagents).
5. ffmpeg post-processing + site manifest; wire one scenario into the website as proof.
