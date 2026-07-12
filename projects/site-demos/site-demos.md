# Site Demos — staged data + scripted capture pipeline

Charter for generating the marketing site's demo assets: authentic staged data (real fake
repos, meaningful workspaces), an isolated Otto stack seeded with that data, and
Playwright-driven scenario scripts that walk real workflows while capturing PNG screenshots
and MP4/WebM video for slideshows and tutorials on otto-code.me.

**Status:** approved 2026-07-11; pipeline + scenario 03 shipped and verified the same day
(`npm run demo` → `npm run demo:assets` produces 7 PNGs + MP4/WebM + manifest for
03-diff-review). Scenarios 01/02/04 are next.

## Learnings from the first shipped scenario (03)

- **Never fork the dev home for Claude captures.** `E2E_FORK_OTTO_HOME_FROM` copies the
  developer's real projects/agents into the demo daemon and they pollute the sidebar in
  screenshots. Claude auth is machine-level (`~/.claude`), so real Claude turns work
  unforked: `demo:real` / `demo:spread:real` set `DEMO_REAL=1` with no fork. Only
  providers whose auth lives in Otto's config (openai-compat endpoints, LM Studio keys)
  will need a fork — use a curated config-only source home for those, never
  `.dev/otto-home` directly.
- **Per-platform capture themes (user decision):** desktop/site assets = Neotokyo
  (`darkTheme: "cyberpunk"` + `syntaxTheme: "neotokyo"`), Android phone/tablet = stock
  dark, iOS = light. Wired in `appearanceForProject()` in the spread spec and per-scenario
  `applyDemoAppearance` options.
- **Store-listing aspect ratios are strict.** Play phone/tablet shots must be exactly 9:16
  or 16:9 (spread-mobile 360×640@3x → 1080×1920; spread-tablet 1280×720@2x → 2560×1440);
  the desktop viewport (1440×900) is 16:10 and NOT store-valid. App Store 6.7" =
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
- **Dark theme only** for the proof pass; a dedicated theming demo comes later.
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
    helpers/
      capture.ts                  # shot(page, name), step() manifest recorder
      pacing.ts                   # humanType/humanClick/pause — natural cadence for video
      agent-waits.ts              # state-based waits: streaming started, tool call visible,
                                  # todo list rendered, agent finished
    scenarios/
      01-agent-live.demo.ts
      02-preview-verify.demo.ts
      03-diff-review.demo.ts
      04-personalities.demo.ts
  scripts/
    demo-postprocess.mjs          # ffmpeg: webm → mp4 + webm, trim per manifest timestamps
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

- Desktop 1440×900, dark theme (site default) — proof pass.
- Light theme and mobile 390×844 are later passes over the same scenarios (presets, not
  rewrites).

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

## Scenario catalog (expanded 2026-07-11)

Tiered by capture cost: **free** scenarios run scripted with no agent tokens and are cheap
to re-record; **real-run** scenarios execute an actual provider and go through
`npm run demo:real`. Staged-data opportunities are called out — artifacts and schedules
persist as files the seeder can plant, so those surfaces demo populated without any run.

| #   | Scenario          | Shows                                                                                                              | Cost     | Status      |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------- | ----------- |
| 03  | diff-review       | File explorer, file tabs, changes list, diff views                                                                 | free     | **shipped** |
| 01  | agent-live        | Create agent, streaming, tool calls, todos, finish + diff stat                                                     | real-run | storyboard  |
| 02  | preview-verify    | Launch config → dev server → browser pane → agent proof                                                            | real-run | storyboard  |
| 04  | personalities     | Personality picker, orchestrator spawning subagents, track rows                                                    | real-run | storyboard  |
| 05  | diff-ai-review    | Extends 03: inline comment on a diff line → agent applies the fix live → diff updates → header Commit              | real-run | storyboard  |
| 06  | homepage-tour     | Home surface: workspace list, History, Schedules, Artifacts nav, new-workspace entry                               | free     | idea        |
| 07  | themes            | Theme system: appearance settings, dark ↔ light, syntax themes — same workspace re-captured per theme              | free     | idea        |
| 08  | artifacts         | Artifacts gallery + artifact tab; seeder plants `.otto/artifacts/*.json+html` in the staged repo so it's populated | free¹    | idea        |
| 09  | schedules         | Schedule form (the golden form), schedules list; seeder plants `schedules/*.json` in the demo home                 | free     | idea        |
| 10  | workspace-layouts | Split panes, agent + terminal + file + browser side by side, tab drag, file mode bar (editor/split/preview)        | free     | idea        |
| 11  | terminals         | Terminal tabs, splits, activity indicators while commands run                                                      | free     | backlog     |
| 12  | multi-provider    | Provider picker: Claude Code / Codex / OpenCode / LM Studio local — the fork's core pitch                          | free²    | backlog     |
| 13  | mobile            | Re-run shipped scenarios at 390×844 — the "your pocket" pitch                                                      | free     | backlog     |
| 14  | worktrees         | Branch-off workspace creation, isolated worktree, setup scripts                                                    | free     | backlog     |
| 15  | editor-ide        | CM6 editing, split/preview mode bar, project search, file finder                                                   | free     | backlog     |

¹ free if seeded; a real-run variant shows an agent _creating_ an artifact.
² picker/UI only; running a local model live would need LM Studio reachable at capture time.

Scenario 05 storyboard (the requested AI-diff beat): open the pending storefront diff as in
03 → hover a changed line → inline review comment ("also match the product blurb, and
debounce the filter") → the comment routes to the workspace agent → agent runs visibly,
edits land → diff refreshes with the new hunks → click header **Commit**. Ends the git
story on camera. Requires the selective provider fork (below).

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

## Non-determinism playbook (real runs)

- Prompts are small, single-outcome tasks; the staged code is written so the "right" fix is
  obvious and fast.
- All waits are state-based with generous budgets; a scenario that ends in the wrong state
  fails loudly instead of capturing garbage.
- Re-record is per-scenario, cheap to invoke; the manifest makes partial retakes (screenshots
  only, video only) possible.
- Screenshots of _finished_ states are stable even when the mid-run token stream varies.

## Open questions

1. Dark-only for the proof pass, or dark + light from the start?
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
