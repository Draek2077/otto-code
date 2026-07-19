# Demo capture pipeline

Playwright scripts that drive the real app and record screenshots + video for
otto-code.me and the app stores. Never touches your real daemon (`~/.otto`,
port 6868) — every run boots an isolated temp stack.

For the full design rationale, scenario catalog, and storyboards, see
[`projects/site-demos/site-demos.md`](../../../projects/site-demos/site-demos.md).
For the scenario-authoring recipe, selector map, and gotchas ledger, see
[`projects/site-demos/runbook.md`](../../../projects/site-demos/runbook.md).
This file is the short version: how to run what's already built.

## Quick start

**The easy way — run this, answer the prompts:**

```bash
npm run demo:run
```

Interactive menu: pick a scenario, pick a UI zoom, pick a theme, pick a provider
(only asked when it matters). It handles every env var itself (`DEMO_REAL`,
`DEMO_ZOOM`, `DEMO_PROVIDER`, `DEMO_MODEL`, `E2E_LOCAL_AI`, the Windows
`E2E_BROWSER_CHANNEL` flag) — nothing to remember or type by hand. It also asks
for confirmation before any run that spends real provider tokens, builds the
desktop app first for Electron scenarios, and prints the output folder to review
when it's done. Source: `demo/scripts/run.mjs`.

Everything below is the manual/scriptable equivalent, useful for CI, one-off
overrides, or if you just prefer typing commands directly.

```bash
# Free scenarios (no provider tokens). Captures BOTH themes (Twilight + Daylight).
npm run demo -- 04-personalities 05-agent-teams 06-model-picker

# One theme only — faster iteration while authoring
npm run demo:twilight -- 04-personalities
npm run demo:daylight -- 04-personalities

# Real-run scenarios (spends Claude tokens on Sonnet 5 by default — see
# "Choosing a provider" below to run against local-AI instead)
npm run demo:real -- 07-subagent-track
npm run demo:real:twilight -- 07-subagent-track   # one theme, cheaper to iterate

# Stills sweeps — desktop x2 themes + phone + tablet + iOS store shots
npm run demo:spread
npm run demo:spread:real     # adds the agent-chat surface (one real Claude turn)

# Real Electron app capture (native window, <webview> preview pane, OS chrome)
npm run demo:electron -- electron-smoke                        # no provider (mock agent)
cross-env DEMO_REAL=1 npm run demo:electron -- 02-preview-verify # real turn, Claude/Sonnet 5

# Turn a scenario's .out/ into site-ready assets (PNG + MP4/WebM + manifest.json)
npm run demo:assets -- 04-personalities-twilight 04-personalities-daylight

# One-off static brand renders (no daemon, no browser automation loop)
npm run demo:feature-graphic   # Play Store feature graphic (1024x500)
npm run demo:og-image          # site og:image / twitter:image (1200x630)
```

Omit the trailing filter args to run every scenario in that lane. Filters
match on filename fragment.

**Windows:** local runs need `E2E_BROWSER_CHANNEL=msedge` prefixed on the
command (Chrome/Chromium isn't installed by default).

Runs are long — first invocation ~7 min (Metro cold start), warm ~2 min.
`npm run demo` doubles that (both themes = two full passes). Run in the
background and read the log after; don't block on it in the foreground.

## Where output lands

- Local captures: `packages/app/demo/.out/<scenario>-<theme>/shots/*.png` +
  `manifest.json`. Playwright video lands in `test-results/`.
- Site-ready assets (after `demo:assets`): `packages/website/public/demos/<scenario>-<theme>/`.
- Brand renders: `packages/website/public/demos/brand/*.png` (feature graphic),
  `packages/website/public/og-image.png` (site meta image — a live asset, not
  demo scratch).
- Electron smoke captures: `packages/app/demo/.out/electron-smoke/`.

**Everything under `demo/.out/` and `website/public/demos/` is gitignored.**
It's pure generated output — safe to `rm -rf` either directory at any time;
the next run recreates it from scratch.

## What's in this folder

```
demo/
  staging/
    templates/        # two fake-but-real staged repos (checked in as source)
    materialize.ts     # template -> temp dir, git history, uncommitted changes
    seed.ts             # registers projects/workspaces/agents over the daemon WS
    cast.ts              # shared demo personalities + teams for people-scenarios
  helpers/
    capture.ts          # DemoRecorder — shot()/finish(), writes manifest.json
    theme.ts             # resolveDemoTheme(playwrightProjectName)
    pacing.ts             # humanClick/humanType/beat/pause — natural on-camera cadence
    appearance.ts          # applyDemoAppearance(page, theme)
  scenarios/
    *.demo.ts            # web pipeline: Playwright Chromium, playwright.demo.config.ts
    *.spread.ts            # stills sweeps (no video/pacing), same config
    *.electron.ts            # real Electron app, playwright.demo-electron.config.ts
  assets/
    *.html                     # static brand-card templates (source, not output)
  scripts/
    postprocess.mjs              # ffmpeg: trims/transcodes video per manifest
    feature-graphic.mjs           # renders assets/feature-graphic.html -> PNG
    og-image.mjs                   # renders assets/og-image.html -> PNG
```

## Choosing a provider for real-run scenarios

Real-run scenarios execute an actual agent turn, so they cost real tokens
against a real account. Provider/model must never be silently hardcoded in a
scenario file — it's chosen via env vars. Scenarios that call
`demo/helpers/provider.ts`'s `resolveDemoProvider()` (`01-agent-live`,
`02-preview-verify`, and any new one going forward) read two env vars:

- `DEMO_PROVIDER` — `"claude"` (default) or `"local-ai"`.
- `DEMO_MODEL` — overrides the model id for whichever provider is selected;
  otherwise `"claude"` defaults to `"sonnet"` (never `"opus"` unless you pass
  it — cheap and full-featured is the point) and `"local-ai"` uses
  `E2E_LOCAL_AI_MODEL` from `.env.test`.

**Default is Claude on Sonnet 5** (user decision, 2026-07-18): cheap relative
to Opus, and the only provider with the full feature set demo captures need
— the local-AI/openai-compatible tool catalog has no TodoWrite-equivalent,
so any scenario beat built around planning/todos can't run on it (confirmed
against `01-agent-live`'s build). Local-AI stays available for scenarios that
don't need Claude-only capabilities:

```bash
cross-env DEMO_PROVIDER=local-ai npm run demo:real:local-ai:twilight -- 01-agent-live
```

`DEMO_PROVIDER=local-ai` requires `E2E_LOCAL_AI=1` plus
`E2E_LOCAL_AI_BASE_URL` / `E2E_LOCAL_AI_API_KEY` / `E2E_LOCAL_AI_MODEL` in the
repo-root `.env.test` (same vars the `local-ai` e2e tier uses — see
`e2e/helpers/local-ai.ts`). `demo:real:local-ai*` and
`demo:electron:real:local-ai` set `E2E_LOCAL_AI=1` for you.

**hero-shot, 07-subagent-track, 08-visualizer, and 09-composer-intelligence
predate this convention and still hardcode `provider: "claude"` directly**
(no `DEMO_MODEL`/local-ai override) — functionally the same default as above,
just not routed through `resolveDemoProvider()`. Migrating them is a known
follow-up, not done yet.

## The two capture lanes

**Web (`*.demo.ts`, `*.spread.ts`)** — runs against Playwright Chromium
loading the app's web build. This is the default lane and covers almost
everything: chat, settings, personalities, diffs, the Visualizer, etc.

**Electron (`*.electron.ts`)** — launches the real `packages/desktop` app via
Playwright's `_electron` module. Only needed for things the web build
structurally can't show: the `<webview>`-based Preview browser pane (only
wired up in Electron, see `browser-pane.electron.tsx`) and the native OS
window chrome (title bar, minimize/maximize/close). Everything else about the
scenario shape — seeding, pacing, manifest — is the same; use
`e2e/helpers/electron-app.ts`'s `launchDesktopElectron()` instead of the
`page` fixture, and `captureWindowWithChrome()` instead of
`page.screenshot()` when you need OS chrome in the shot (true `desktopCapturer`
screen capture — a page screenshot can never include it).

**Desktop captures output 2560×1440 (16:9 QHD)**, `demo/helpers/resolution.ts`'s
`DESKTOP_CAPTURE_RESOLUTION`. That's the _output_ pixel size, not the layout
size: the app lays out at `DESKTOP_LAYOUT_VIEWPORT` (1024×576 logical at the
current 2.5× scale) and is captured at `DESKTOP_CAPTURE_SCALE`, so the UI
renders large while the PNGs still land at full QHD. Setting the viewport
straight to 2560×1440 with scale 1 is the classic mistake — the app then lays
out as if on a giant screen and every control renders tiny.

The zoom is the `DEMO_ZOOM` env var (logical width = 2560 ÷ zoom); the
`demo:run` menu asks for it, or set it by hand for the manual commands
(`cross-env DEMO_ZOOM=3 npm run demo -- hero-shot`). It defaults to
`DEFAULT_DESKTOP_CAPTURE_SCALE` (2.5) when unset. **Hard ceiling ≈ 3.0:** below
the `md` breakpoint of 768px logical width the app flips to its compact/mobile
layout (split panes gone), and 2560 ÷ 768 ≈ 3.33 — so 3.0 (853px wide) is the
biggest zoom that stays a real desktop layout, and `resolution.ts` clamps higher
values. Higher zoom also shrinks logical _height_ (2.5 → 576, 3.0 → 480),
leaving tall content less vertical room.

The web lane gets this from the Playwright project's `viewport` +
`deviceScaleFactor`. The Electron lane can't rely on a fixed scale — a real OS
window's screenshot reflects the capturing machine's actual display scale
factor — so Electron scenarios pass `windowSize: DESKTOP_LAYOUT_VIEWPORT` (the
logical DIP window size) to `launchDesktopElectron()` and
`targetSize: DESKTOP_CAPTURE_RESOLUTION` to `DemoRecorder.start()` (or call
`resizePngToTarget()` from `e2e/helpers/image.ts` directly for one-off
screenshots), which resizes each shot to the exact output size regardless of
the machine. See `02-preview-verify.electron.ts` for the pattern.

## Isolation guarantees

No manual reset needed between runs:

1. Every invocation boots a fresh temp `OTTO_HOME` with its own daemon on
   dynamic ports. Your real `~/.otto` / port-6868 daemon is never touched.
2. `materialize.ts` wipes and rebuilds the staged repos from the checked-in
   templates before each run — nothing an agent edits during a run leaks
   forward.
3. Playwright gives each test a fresh browser context.

Scenarios within one invocation share a daemon, so each scenario cleans up
its own seeded data in `afterAll`. Prefer one scenario per invocation for
pristine output.

## Writing a new scenario

Copy the skeleton and rules in
[`runbook.md` §3](../../../projects/site-demos/runbook.md#3-authoring-a-new-scenario--the-recipe)
— it has a working template, the state-based-waits/whole-frame rules, and the
verification loop (run → open every PNG and actually look at it, in both
themes, before calling it done). Check the
[gotchas ledger](../../../projects/site-demos/runbook.md#6-gotchas-ledger)
first; most first-attempt failures are already logged there.
