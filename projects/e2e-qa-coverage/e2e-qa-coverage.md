# E2E QA Coverage — full-app Playwright test plan

**Goal:** every user-facing feature of Otto has locally runnable Playwright coverage, organized
by feature category, with a mechanical way to see what is covered and what is not — so cutting
a release means running known suites, not hoping.

This project does not replace the existing harness; it organizes and extends it. The harness in
`packages/app/e2e/` is already strong: 80+ specs, a fully isolated daemon/relay/Metro stack per
run (`global-setup.ts` forks a throwaway `OTTO_HOME`), a deterministic mock agent
(`helpers/mock-agent.ts`), and a credentialed real-provider tier (`*.real.spec.ts`). What is
missing is (1) a feature-complete map of what those specs cover, (2) coverage for the fork's
newer subsystems (personalities, teams, visualizer, permission modes, openai-compat native
tooling, artifacts, preview), and (3) a cheap way to run _live agent-loop_ journeys without
burning paid API credits.

## The three tiers

| Tier                 | Suffix                  | What it proves                                                                                                                                                                                      | Cost             | When it runs                         |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| **T1 Mock**          | `*.spec.ts`             | UI + daemon behavior with the deterministic mock agent. The bulk of coverage.                                                                                                                       | Free             | Every category run; CI shards        |
| **T2 Local-AI**      | `*.local.spec.ts` (new) | Full live agent loop — prompt → tool calls → file edits → diff/UI updates — via the **openai-compat provider pointed at LM Studio** (qwen3.6-27b-mtp over Tailscale). Real inference, zero dollars. | Free (local GPU) | Release validation; opt-in locally   |
| **T3 Real provider** | `*.real.spec.ts`        | Provider-specific integration (Claude/Codex/OpenCode/Pi rewind, session import).                                                                                                                    | Paid             | Release validation only, minimal set |

Design rule for T2/T3 specs: **assert on side effects, not on model prose.** A live-model spec
asks the agent to do something with an unambiguous observable outcome (create a file with exact
content, run a command) and asserts the outcome appears in the UI (diff row, tool call row,
terminal output). Never assert on the assistant's wording. See
[local-ai-tier.md](local-ai-tier.md) for the full tier design.

## Coverage model

The single source of truth is [coverage-matrix.md](coverage-matrix.md): one section per feature
category, one row per feature behavior, each row marked ✅ (covered), 🟡 (partial), or ❌ (gap),
with the covering spec files named inline.

`node scripts/e2e-coverage-check.mjs` keeps the matrix honest:

- **Stale rows** — matrix names a spec file that no longer exists → error.
- **Unmapped specs** — a spec file on disk that no matrix row claims → error. New specs must be
  added to the matrix in the same change; the check makes forgetting impossible.
- **Scoreboard** — per-category ✅/🟡/❌ counts, so "how covered is Git & Changes?" is one command.

The check is pure file analysis (no daemon, no browser, <1s) and is safe to wire into CI later.

The matrix is also what groups the **run report** — the reporter reads its sections to bucket
every test under its module, so the plan document and the run artifacts stay in lockstep. What a
run produces (per-module table of contents, per-test evidence directories, the money-shot digest,
the failure report) and the conventions for money shots and regression specs are in
[reporting.md](reporting.md).

## Running locally

The repo rule "never run the full Playwright suite locally" exists because whole-suite runs
freeze the machine. The unit of local execution is therefore the **category batch** — Playwright
already runs `workers: 1`, so one category at a time is tractable:

```powershell
npm run e2e -- e2e/terminal-*.spec.ts    # one category (filenames grouped per category in the matrix)
npm run e2e                              # T1: every mock spec
npm run e2e:local-ai                     # T2: *.local.spec.ts against LM Studio
npm run e2e:real                         # T3: *.real.spec.ts (paid)
npm run e2e:coverage                     # matrix <-> disk drift check (no daemon, <1s)
npm run e2e:report                       # open Playwright's HTML report from the last run
```

A full sweep should go to a file and be read afterwards, never watched:
`npm run e2e > $env:TEMP\e2e-sweep.txt 2>&1`.

**Browsers are a one-time install, not a per-run flag.** `npm run e2e:install` fetches the
chromium build the pinned Playwright needs. Missing it produces
`Executable doesn't exist at ...chromium_headless_shell-<rev>`, because headless mode launches
the headless shell — having the full `chromium-<rev>` is not enough, and a bare
`playwright install` after a version bump only lands what that version pins. Setting
`E2E_BROWSER_CHANNEL=msedge` drives installed Edge instead; that is an escape hatch for a
machine that can't download browsers, not the normal path, and it tests Edge rather than the
browser CI runs.

Phase 1 adds Playwright `@cat:*` tags to every `test.describe`, so category runs become
`--grep @cat:terminal` instead of filename globs, and the coverage check can verify tags too.

## Release validation runbook (target state)

When cutting a release (rides alongside the `release` skill, does not block it yet):

1. **T1 full sweep** — all categories, sequentially, locally overnight or via CI shards. Must be green.
2. **T2 local-AI journeys** — the ~10 core-journey `*.local.spec.ts` specs against LM Studio.
   Requires the qwen model loaded in LM Studio first.
3. **T3 real smoke** — the existing `rewind-flow.*.real.spec.ts` set plus one send/receive smoke
   per provider you actually ship against. Paid; smallest possible set.
4. `node scripts/e2e-coverage-check.mjs` — confirm no unmapped/stale drift entered the release.

## Phases

- **Phase 0 — DONE:** charter, coverage matrix seeded from all existing specs, local-AI tier
  design doc, coverage-check script.
- **Phase 2 — BUILT:** `local-ai` Playwright project + `test:e2e:local-ai`; global-setup
  preflights LM Studio (`/models`) and injects the openai-compat provider (values from the
  repo-root `.env.test`, never committed) into the isolated `OTTO_HOME` when `E2E_LOCAL_AI=1`;
  6 T2 specs written (loop, permissions, max-rounds, compaction, resume, rewind).
- **Phase 3 — BUILT (unvalidated):** 31 new T1 specs across personalities/teams, permissions +
  safe-unattended + wizard, chat/composer, git/changes, settings/visualizer, schedules/runs,
  files/editor. All 🟡 in the matrix until the iron-out pass. Supporting mock-provider
  extensions: synthetic tool-permission scenario, dev-only `dontAsk` mode, prompt-triggered
  suggestion/rate-limit/markdown/tool-call scenarios, structured title responder, no-op
  `applyPersonality`.
- **Phase 3.5 — NEXT: iron-out.** Run batches per [iron-out.md](iron-out.md), fix
  selector/timing drift, promote 🟡 → ✅.
- **Phase 1 — organize (deferred):** add `@cat:*` tags to specs; category npm scripts; wire
  coverage check into CI.
- **Phase 4 — remaining gaps:** work down the 24 ❌ rows in priority order (observed subagents,
  artifacts/preview, vision, relay pairing, compact-layout smoke, …); each new feature PR adds
  its matrix row + spec together.

## Out of Playwright-web scope

Electron-only behavior (GPU fallback relaunch, focus-mode caption strip, tray, native menus,
real desktop updates) cannot run in the web harness. These stay on the desktop side:
`docs/browser-capture-harness.md` for screenshot-level checks, plus a short manual checklist in
the release runbook. Native mobile flows belong to Maestro (`docs/mobile-testing.md`), not this
project.
