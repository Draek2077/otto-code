# Website showcase: the eleven sections and the assets that prove them

Companion to [marketing-strategy.md](marketing-strategy.md) and
[feature-inventory.md](feature-inventory.md). Where the inventory is the **accounting** (238
verified items in 21 subsystem groups), this page is the **staging plan**: how those groups collapse
into eleven landing-page sections, and exactly which capture produces each image.

**Status is not here.** Progress lives in the 🟡 _Site demos: the scenario backlog_ entry in
[`projects/README.md`](../README.md#testing--tooling), which is the single ledger. This page is the
plan that entry tracks against.

**The pipeline is [docs/site-demos.md](../../docs/site-demos.md).** Every rule there applies: one
run one feature, the whole frame is the demo, fill every form before photographing it. Nothing below
overrides it.

---

## The argument

The landing page today sells Paseo's foundation across six separate sections and Otto's own work
across five hand-drawn simulations. That inverts the story. Consolidated, the base becomes one
confident section at the end (_look how solid the ground is_) and the eleven sections above it are
Otto's.

Two ordering rules decided this sequence:

1. **Visual wow first, depth second, foundations last.** A visitor decides in one scroll.
2. **Differentiated before merely good.** §1, §2 and §9 are the three nobody else ships. Everything
   else is evidence the product is finished, and must not be laid out as ten equal tiles beside them.

---

## Section order

Each row lists the [feature-inventory](feature-inventory.md) groups it draws from, so a section's
claims stay traceable to verified items.

| #   | Section                      | Inventory groups drawn from                                                                 |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | The Visualizer               | Visualizer (21)                                                                             |
| 2   | Agents that prove their work | Preview & browser verification (10)                                                         |
| 3   | A team of agents, by name    | Agent personalities (12), Agent teams (6), Orchestration (11)                               |
| 4   | Work that runs without you   | Artifacts (part of 11), Schedules (4), Subagents & background (11), Safety & unattended (7) |
| 5   | An IDE, not a chat box       | Editor (14), Code intelligence (10), Solution view (3)                                      |
| 6   | The interface you live in    | Composer & chat (17), Document rendering (9), widgets (part of 11), Onboarding & UI (17)    |
| 7   | Know what it costs           | Accounting & context (17)                                                                   |
| 8   | Review, preview, ship        | Git & changes (14), Workspaces & projects (11)                                              |
| 9   | Bring any model              | Providers (14)                                                                              |
| 10  | Voice                        | Speech & voice (8)                                                                          |
| 11  | Built on Paseo               | Platform, ops & release (11), plus the whole upstream foundation                            |

§11 absorbs six sections that exist today and are all upstream: `SelfHostedSection`,
`MultiProviderSection`, `SplitPanelsSection`, `ShortcutsSection`, `ServiceProxySection`,
`CLISection`, plus the credit copy currently in `BuiltOnOpenSourceSection`. The Agent Flow credit
moves up into §1 as a one-line link, because that is where the visitor is looking at Simon's work.

---

## WebsiteHero

One full-frame asset, above the fold, and the only full-size image on the page. Everything else is a
focus crop.

**It is a looping capture, not a still.** The mockup it replaces animates: the six-dot
`SyncedLoader` spinning is what makes the hero feel alive, so the replacement must move
too. Capture video, loop it silently, and let the motion come from a real agent mid-turn: spinner
spinning, tokens streaming, a tool row landing.

**Staging.** No third template repo. `mango-storefront` is already the photogenic one and gets a
curation pass instead (below). In frame, all of it in a good state because the whole frame is the
demo:

- Sidebar: both staged repos, several workspaces, at least one with a live status dot.
- Main pane: a chat mid-turn, real provider content, a personality name and colour on the running agent.
- Second pane: the diff or the browser pane, something with visible colour, never a terminal wall of text.
- Title bar, composer and tab row all consistent with a turn in progress.

**Producing scenario:** `00-website-hero` (absorbs today's `hero-shot`). Twilight only.

### The curation pass on `mango-storefront`

The hero and roughly half the focus shots photograph this repo's file tree, diffs and editor
buffers, so its contents are site copy. Requirements:

- **Filenames read as a real product.** `Header.jsx`, `Hero.jsx`, `ProductGrid.jsx`, `CartBadge.jsx`
  already do. Nothing named `test2.js`, nothing left at `App.jsx` doing everything.
- **Comments are written to be read at 2.5× zoom.** Short, sentence-case, explaining intent rather
  than restating the line. They will be legible in every editor and diff shot.
- **The uncommitted working changes tell one story**, not five unrelated edits. The diff panel is
  photographed in §8 and must read as a coherent piece of work.
- **Commit messages are plausible and well-formed.** They appear in Git Log, blame and file-history
  shots.
- **No lorem ipsum, no placeholder copy** anywhere that renders in the browser pane, because §2 photographs
  the running storefront.

`pulse-api` needs the same pass at lower priority; it backs the test-running and suggested-task
beats rather than the marquee shots.

---

## The shot manifest

`kind` is `full` (one only), `focus` (a crop of one surface) or `loop` (silent looping video).
Asset convention: `packages/website/public/shots/<id>.png` or `.webm`, a **committed** directory,
hand-picked out of the gitignored `public/demos/` run output. The site is dark-only, so **Twilight
only**; no Daylight pass is needed for any of these.

`(new)` in the scenario column means that scenario does not exist yet.

| Shot id              | §    | Kind  | Producing scenario                            |
| -------------------- | ---- | ----- | --------------------------------------------- |
| `hero-desktop`       | hero | full  | `00-website-hero`                             |
| `viz-graph`          | 1    | loop  | `08-visualizer`                               |
| `viz-node`           | 1    | focus | `08-visualizer`                               |
| `viz-pip`            | 1    | focus | `08-visualizer`                               |
| `preview-verify`     | 2    | loop  | `02-preview-verify` (Electron)                |
| `preview-proof`      | 2    | focus | `02-preview-verify`                           |
| `preview-console`    | 2    | focus | `02-preview-verify`                           |
| `team-roster`        | 3    | focus | `04-personalities`                            |
| `team-switcher`      | 3    | focus | `05-agent-teams`                              |
| `team-runs`          | 3    | focus | `23-orchestration-runs` (new)                 |
| `team-memory`        | 3    | focus | `23-orchestration-runs` (new)                 |
| `auto-artifacts`     | 4    | focus | `13-artifacts` (new)                          |
| `auto-artifact-tab`  | 4    | focus | `13-artifacts` (new)                          |
| `auto-schedules`     | 4    | focus | `14-schedules` (new)                          |
| `auto-suggested`     | 4    | focus | `09-composer-intelligence`                    |
| `ide-definition`     | 5    | focus | `19-editor-ide` (new)                         |
| `ide-diagnostics`    | 5    | focus | `24-code-intelligence` (new)                  |
| `ide-rename`         | 5    | loop  | `24-code-intelligence` (new)                  |
| `ide-solution`       | 5    | focus | `24-code-intelligence` (new)                  |
| `ui-widget`          | 6    | focus | `22-widgets` (new)                            |
| `ui-tasklist`        | 6    | focus | `01-agent-live`                               |
| `ui-mermaid`         | 6    | focus | `22-widgets` (new)                            |
| `ui-themes`          | 6    | focus | `12-themes` (new, triptych of 3 themes)       |
| `cost-context`       | 7    | focus | `20-context-cost` (new)                       |
| `cost-ledger`        | 7    | focus | `20-context-cost` (new)                       |
| `cost-metrics`       | 7    | focus | `20-context-cost` (new)                       |
| `ship-diff`          | 8    | focus | `03-diff-review`                              |
| `ship-commit`        | 8    | focus | `10-diff-ai-review` (new)                     |
| `ship-blame`         | 8    | focus | `25-git-history` (new)                        |
| `ship-worktree`      | 8    | focus | `18-worktrees` (new)                          |
| `model-local`        | 9    | focus | `17-multi-provider` (new)                     |
| `model-local-verify` | 9    | loop  | `02-preview-verify`, `DEMO_PROVIDER=local-ai` |
| `voice-mode`         | 10   | loop  | `21-voice` (new)                              |
| `voice-playback`     | 10   | focus | `21-voice` (new)                              |
| `paseo-panes`        | 11   | focus | `15-workspace-layouts` (new)                  |

**35 shots: 1 full frame, 29 focus, 5 loops.** The full frame is itself captured as a loop, so six
assets are video. Twelve already have a producing scenario; the rest need one. Verified against the
rendered page: `document.querySelectorAll('[data-shot-placeholder]')` returns 34, the hero being
the one slot still filled by the old mockup.

### Cheapest wins first

- `model-local-verify` is the single highest-value shot per unit of work in the table: it is
  `02-preview-verify` re-run with one environment variable flipped, and it is the proof that §2 is
  not Claude-only. Build nothing, spend one run.
- `feature-spread.spread.ts` is a **declarative surface list**: adding a surface is a route plus a
  name. `cost-context`, `cost-ledger`, `ide-solution` and `paseo-panes` are all reachable that way
  without authoring a narrative scenario.
- `13-artifacts` and `14-schedules` are free of provider tokens **if the seeder plants the files**,
  as already noted in the ledger.

---

## What the landing page loses

Five hand-built simulations come out. Each shows a surface that is not Otto's, and three assert
outcomes that no code produces:

| Removed                      | Why                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `WorkflowSection`            | Fake browser, grey rectangles, an invented `checks passed` chip                     |
| `SplitPanelsSection`         | Four grey tiles labelled Agent / Browser / Terminal / Diff                          |
| `PreviewVerificationSection` | A hand-written checklist of things the agent "did"; no Otto surface looks like this |
| `PersonalitiesSection`       | Hardcoded starter-roster cards that are not the real picker                         |
| `LocalVoiceSection`          | A 48-bar CSS waveform and a scripted word-by-word transcript                        |

`HeroMockup` is a sixth: a 1,005-line React replica of the whole desktop UI. It stays on disk and
keeps rendering behind a single flag until `hero-desktop` exists, then goes.

**What survives is the framing.** [docs/site-demos.md](../../docs/site-demos.md) already settled
this (_"Bare web app capture; window chrome is the site's job"_) so the polish these components
carry becomes the frame around real captures rather than the content inside them. Two things in the
absorbed sections are also honest and stay: the self-hosted bezier diagram (a diagram, labelled as
one) and the CLI code blocks (real commands).

---

## Placeholders as the backlog

Until an asset exists, `<FeatureShot>` renders a correctly-proportioned placeholder carrying its
shot id, kind and the producing scenario. The landing page is therefore its own capture checklist,
and no section can point at an asset with no producer. The site deploys manually
(`npm run deploy`), so placeholders cannot reach production by accident, but the page should not be
deployed until at least the hero and §1 to §3 have real assets.
