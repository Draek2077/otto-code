# Projects — charters and the open-work ledger

**This file is the single source of truth for what is done and what is not.** It stays at the base of
`projects/` permanently. Nothing else in this tree tracks status.

Navigation: [Repository documentation index](../README.md#documentation) ·
[Software documentation (`docs/`)](../docs/README.md) · [Agent working rules (`CLAUDE.md`)](../CLAUDE.md)

## Contents

- [What belongs here](#what-belongs-here)
- [The rules](#the-rules)
- [Active charters](#active-charters)
- [Open work](#open-work) — [Editor & code intelligence](#editor--code-intelligence) ·
  [File rendering](#file-rendering) · [Git, changes & comments](#git-changes--comments) ·
  [Subagents & background tasks](#subagents--background-tasks) · [Visualizer](#visualizer) ·
  [Performance](#performance) · [Onboarding & UX](#onboarding--ux) ·
  [Providers & accounting](#providers--accounting) · [Testing & tooling](#testing--tooling) ·
  [i18n](#i18n)
- [Build order](#build-order)
- [Deferred indefinitely](#deferred-indefinitely)
- [Owed fold-ins](#owed-fold-ins)

---

## What belongs here

`projects/` holds **point-in-time plans**: a charter for something not yet built, a build plan for
work in flight, a design document for a decision being taken. One initiative, one folder.

It is not documentation. Durable, evergreen facts about how Otto works live in
[`docs/`](../docs/README.md). The distinction is the tense: a charter says _what we will build_; a doc
says _how it works_.

## The rules

1. **One folder per initiative**, named for the initiative. The charter is
   `<folder-name>/<folder-name>.md`. Sub-plans the work genuinely needs (a phase breakdown, a
   library evaluation, a runbook) sit beside it in the same folder.
2. **No progress documents.** No work-package reports, no dated batch triage, no second registry.
   Progress is a row in this file. If a document only records _what happened_, it does not belong in
   the tree — its conclusions go into the charter or into `docs/`, and the document is dropped.
   **Measured investigations are the one exception with a home of their own:** they go to
   [`findings/`](../findings/README.md), never here.
3. **Status lives here, not in the charter.** A charter may describe its own phases; it does not get
   to be a competing ledger.
4. **When a project ships, it drains and leaves.** Fold the durable facts into the relevant `docs/`
   page, move any remaining tail into [Open work](#open-work) below, then remove the folder. A
   shipped project sitting in `projects/` is the most common way this tree rots.
5. **Removed folders go to `archive/`** at the repo root, which is gitignored. Nothing is destroyed;
   it simply stops being part of the repo. If something is genuinely dead — never to be explored
   again — it does not even earn the archive.

## Active charters

Everything currently in this tree. Status vocabulary: **Charter** (nothing built) · **In build** ·
**Partial** (shipped in part, a named remainder open) · **Reference** (not work).

| Project                                                                                         | Status   | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [agent-orchestration](agent-orchestration/agent-orchestration.md)                               | Charter  | The **control layer** — Teams as the way work is invoked, typed tasks, recognize → plan → delegate → synthesize. Quarter-scale. Companion: [invocation.md](agent-orchestration/invocation.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [brain-coding-capabilities](brain-coding-capabilities/brain-coding-capabilities.md)             | In build | Coding-specific functionality on `@otto-code/brain` so a local model reaches hosted-provider parity. Four tracks; **the bench is the spine** (`rankModels` measures coding quality but nothing routes on it yet). **A (built, fast-triage phase):** the SWE-bench harness is wired (`repo-task.ts`), plus the context-utilization metric, the synthetic `extra-long-horizon` task, and now a **window-aware `context-stress`** task (default suite, spec sized to force ≥50% of the served context window to be held) and a **curated mined-repo flow** (`otto brain bench --curated <preset>`, oracle-scoped tests via `curated-repos.ts`). **Next for A:** a separate opt-in heavyweight "deep mode" (15 min–2 hr, LongCLI/SWE-EVO scale), kept isolated from the fast suite. **In flight:** D — feed tool-result images to the model so browser-verify stops being blind on openai-compat (`ottoResultToText` drops image parts); B1 — carry catalog coding metadata onto scanned models. **Next:** B2 (ranking-driven VRAM-aware routing, needs A). **Moved out:** C (inline completion) is an Otto feature, not a brain feature — see [inline-completion](inline-completion/inline-completion.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [brain-host-control](brain-host-control/brain-host-control.md)                                  | Partial  | The resident local-brain's **control surface**. **Built (compiles across six packages, not yet run live):** daemon-managed lifecycle (`BrainManager` spawns `otto brain serve`, health-polls, ledger-registers, restarts on crash, config write-through, dies with the daemon), the `brain.host.*`/`brain.evals.get` RPCs behind `features.brainControl`/`brainStatus`, the Settings → Host → **Local brain** page (status + start/stop/restart + config editing), the **Otto Brain** provider catalog entry, and a live status + eval/ranking **dashboard**. Built-in HTTPS + API-key already retired `otto-brain-relay`'s TLS/auth job. **Built (2026-07-30, TUI-parity model management, verified live in the agent lane):** the daemon drives the otto-brain CLI via a new `BrainOpsManager` (shell-out, never in-process) — reads `brain.models.scan`/`brain.catalog.list`/`brain.runtime.list` and runs `brain.models.pull`/`brain.runtime.install`/`brain.calibrate`/`brain.sweep`/`brain.bench` as tracked jobs the client polls (`brain.jobs.list`/`cancel`), all behind `features.brainManage`; the Brain page gains a **Models** section (runtime install, installed-model list with set-default, catalog with live-progress downloads + cancel + busy-gating) and an **Operations** section (calibrate/sweep/benchmark, gated on a runtime being present); new `otto brain catalog` CLI verb annotates each catalog entry with an installed flag; `pull` now derives the GGUF filename from the catalog id so downloads need no `--file`. Verified end-to-end in the preview (a real HuggingFace download progressed to 5% and canceled cleanly). **Remainder:** websocket push feed (dashboard/jobs poll at 2s today), tray menu item, i18n extraction, richer bench-progress parsing. The brain does not grow its own tray — Otto is the desktop presence; the CLI stays the headless quit path |
| [browser-tab-registry](browser-tab-registry/browser-tab-registry.md)                            | Charter  | A browser tab's identity, liveness and agent-reachability live in three maps with three lifecycles (`OttoBrowserWebviewRegistry`), so a tab can be visibly open and working while `browser_list_tabs` reports it missing. Make the registry authoritative, stop focus changes from reassigning ownership, split `browser_tab_not_found` into "not yours" vs "not there", and invalidate `boundBrowserId`. Observed 2026-07-27 with evidence; the close-one-kills-all report is **unreproduced**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [bug-reporting](bug-reporting/bug-reporting.md)                                                 | Partial  | In-app **Send feedback** ships to Otto's hosted intake — client posts straight to `otto-code.me/api/feedback`, anonymous, no daemon involved ([docs/feedback.md](../docs/feedback.md)). **Open:** the host-owner sink — daemon files a GitHub issue into an owner-configured repo via its own `gh` credentials, for teams collecting their coworkers' reports. Needs `createIssue` on the forge layer, a `bugReporting` config block, and a daemon RPC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [claude-extensions](claude-extensions/claude-extensions.md)                                     | Charter  | Plugins, marketplaces, skills and MCP in the Claude provider settings panel — management plus the always-on context budget nothing else totals. **Deliberately Claude-only**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [computer-use](computer-use/computer-use.md)                                                    | Charter  | Agents see and control the desktop via a shared computer-control library; layered safety. Companion: [computer-control-library.md](computer-use/computer-control-library.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [dictation-refine](dictation-refine/dictation-refine.md)                                        | Charter  | AI cleanup over dictated text via a latency-ordered ladder (lexical → ONNX → optional LLM)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [editor-repo-conventions](editor-repo-conventions/editor-repo-conventions.md)                   | Charter  | Honour the repo's own `.editorconfig` without configuring Otto; repo wins file-shaped settings, user wins view-shaped ones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [e2e-qa-coverage](e2e-qa-coverage/e2e-qa-coverage.md)                                           | Partial  | Full-app Playwright QA across 3 tiers. T1 and T2 green; Phase 3.5 iron-out and the ❌ rows remain. Tier design folded into [docs/testing.md](../docs/testing.md). **[coverage-matrix.md](e2e-qa-coverage/coverage-matrix.md) is live tooling, not a plan** — `scripts/e2e-coverage-check.mjs` and the QA reporter read it at runtime, so this folder cannot drain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [godot-integration](godot-integration/godot-integration.md)                                     | Charter  | The rare engine whose whole project is diffable text, so Changes, blame and history work on it already. Missing: grammars for `.gd`/`.tscn`/`.tres`/`.gdshader`, `project.godot` as a project marker, and a **socket** transport for the LSP pool — GDScript's server is hosted inside the running editor, not spawned over stdio. C# Godot projects need nothing new. Whether the web export runs and is inspectable in Otto's browser pane is unverified and decides how ambitious this gets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [graph-templates](graph-templates/graph-templates.md)                                           | Charter  | **Do the graphs actually work?** The measurement layer (per-node accounting, capability scoring, multi-mechanism grading, a T2 golden-graph harness) plus the starter-template library (Plan–Execute–Verify, review sweep, research→synthesize, full dev process, **Perform and Teach**). Engine-side decisions it builds on: `archdocs/pages/12` §"Decided, not built"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [inline-completion](inline-completion/inline-completion.md)                                     | Charter  | Ghost-text code completion in the editor — **a provider-neutral Otto feature**, not a brain feature — driven by whatever provider the user picks (Claude, OpenAI-compatible, brain). FIM is one implementation strategy (FIM-trained local models via llama.cpp `/infill`); chat providers get prompt-synthesized completion. Task-scoped provider selection like `metadataGeneration.providers`; latency- and cost-guarded, default off. Reframed out of [brain-coding-capabilities](brain-coding-capabilities/brain-coding-capabilities.md) on 2026-07-30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [marketing-strategy](marketing-strategy/marketing-strategy.md)                                  | Charter  | Otto's public voice (Philippe, first person) and the channels still to create. Companions: [feature-inventory.md](marketing-strategy/feature-inventory.md) — the verified full accounting of what Otto adds beyond Paseo (238 items as of 0.7.0), **held locally, published nowhere yet**; [website-showcase.md](marketing-strategy/website-showcase.md) — how those 21 groups collapse into eleven landing-page sections, the 34-shot manifest and the `WebsiteHero` staging definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [mobile-daemon](mobile-daemon/mobile-daemon.md)                                                 | Charter  | Embedded API-native daemon on the phone ("This device" host); no CLIs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [multiplayer](multiplayer/multiplayer.md)                                                       | Charter  | Presence, entering each other's workspaces, opt-in follow — never forced mirroring                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [observed-subagents](observed-subagents/observed-subagents.md)                                  | Partial  | Provider subagents promoted to read-only track rows. Claude proof shipped; generalizing is adapter-only work. **[provider-adapters.md](observed-subagents/provider-adapters.md) is the adapter contract** and is cited from `docs/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [outreach](outreach/outreach.md)                                                                | Charter  | Awareness strategy, website-scoped. Sells nothing. Companions: channels, content, pipeline, runbook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [preview-file-tabs](preview-file-tabs/preview-file-tabs.md)                                     | Charter  | VSCode-style preview tabs (transient vs pinned); web-only idiom                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [remote-brain](remote-brain/remote-brain.md)                                                    | Partial  | Let one daemon manage a **remote** `@otto-code/brain` (on another Otto host) as a first-class target. **Built (read-only remote, phases 1-3):** `brain.mode` local/remote + `brain.remote {host,port,secure,authToken}` (secret-masked) behind `features.brainRemote`; `BrainManager` remote mode repoints the probe endpoint at the remote `/__host/*` so status/evals work unchanged (no spawn, lifecycle refused); the Brain page's Local/Remote switch with remote host fields, hiding the local server/lifecycle blocks. **Built (phase 5, remote config):** brain `POST /__host/config` (auth-guarded) writes config.json and live-applies model/lock (router reads both via live getters); daemon `brain.remote.config.get/patch` proxy; a "Remote configuration" UI section to change the remote brain's default model + lock. Network/TLS/auth stay host-owned by design. **Built (sharing opt-in + control gate):** a brain is loopback-only until its owner opts in — `otto brain share` CLI and a local-only **Sharing** UI section (bind, access = open or a generated key, HTTPS, "allow reconfigure"). `POST /__host/config` is refused (403) unless `allowRemoteConfig` is on, so "can use" ≠ "can configure"; `allowInsecureBind` gates an open non-loopback bind. Remote-config UI shows read-only when the far side hasn't allowed it. **Open:** phase 4 — provider auto-provisioning (daemon wires the `otto-brain` OpenAI-compatible provider from the effective endpoint so inference needs no hand-config); per-client quotas/priority; live-editing remote bind/TLS/auth (needs a remote restart mechanism). Extends [brain-host-control](brain-host-control/brain-host-control.md)                                                                                                                                                                                                   | phase 4 — provider auto-provisioning (daemon wires the `otto-brain` OpenAI-compatible provider from the effective endpoint so inference needs no hand-config); per-client quotas/priority; live-editing remote bind/TLS/auth (needs a remote restart mechanism). Extends [brain-host-control](brain-host-control/brain-host-control.md) |
| [sidebar-reveal](sidebar-reveal/sidebar-reveal.md)                                              | Partial  | Increment 1 (reveal primitive) shipped. Increment 2 (tutorial create-workspace step) **paused until 0.9.x** — product owner, 2026-07-25. Not deferred indefinitely and not unscheduled: it has a version. **This folder holds the only plan for it**, so it stays put until then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [solution-view](solution-view/solution-view.md)                                                 | Partial  | Phases 0 and 1 built — the read-only Solution lens, its sidecar, and its switch. Architecture folded into [docs/solution-view.md](../docs/solution-view.md). Open: Phases 2–4, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [toolchain-catalog](toolchain-catalog/toolchain-catalog.md)                                     | Charter  | One daemon-side catalog of language toolchains, one detection pass, one report. Widens `LSP_SERVER_ROWS` from "which language server" to runtime/package manager/build/test/formatter/project markers, detected on the **daemon's** machine across a workspace → version-manager → PATH → platform ladder. Feeds the Code section, the explorer (`projectMarkers`), agent tool descriptions, and the playbooks. Godot is a deliberate follow-on: its language server is a TCP socket in the running editor, which the stdio-only LSP pool cannot attach to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [upstream-subagent-convergence](upstream-subagent-convergence/upstream-subagent-convergence.md) | Charter  | Stop forking upstream's provider-subagent ingestion — take theirs verbatim, project it into Otto's observed model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [usage-playbooks](usage-playbooks/usage-playbooks.md)                                           | Partial  | One command puts Otto into a named, reproducible starting state in the agent lane. The five-stage spine (`fresh` → `defaults` → `project` → `workspace` → `chat`, on Haiku 4.5 / Sonnet 5 / Opus 5 / Qwen 3.6) is built, clean-slate by default. Four boilerplate templates (Python, C#, Java, TypeScript/HTML/CSS) build green with break branches for four failure shapes, shared with E2E and site captures. Per-feature playbooks (artifacts, schedules, teams, visualizer, changes, editor, preview) remain. Local git only — no GitHub/Bitbucket. Orchestrations deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [user-mode](user-mode/user-mode.md)                                                             | Charter  | The same agentic engine **re-skinned around deliverables instead of a repo**, so a non-coder can generate, view, iterate, save and publish reports/decks/docs/PDFs/illustrations without meeting git, a shell, or a provider setting. Five pillars: a dev/user **mode** primitive driving system-prompt + tool-group gating at the `prepareSessionConfig` choke point (provider-agnostic; Claude is append-only); **deliverables** (artifacts grown past HTML-only into editable, exportable, multi-format, iterated via a Refine-style diff loop); **non-code Save** (git as an invisible backup engine, implicit `git init`, no remote); a **provider-neutral Connectors layer** (packaged MCP + greenfield OAuth, fanned out to every provider, data in / deliverables out); and **view-and-verify** (render → show proof → revise). Authoring model decided: structured intermediate + export, not opaque office files. Carves against [agent-orchestration](agent-orchestration/agent-orchestration.md), [graph-templates](graph-templates/graph-templates.md), [claude-extensions](claude-extensions/claude-extensions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [visualizer-pip](visualizer-pip/visualizer-pip.md)                                              | Partial  | Audio-while-closed **and the PIP window** both shipped — `panels/visualizer-pip-host.tsx`, the toolbar collapse control, four device-local settings fields (`visualizerPipOpen` / `Size` / `X` / `Y`), documented in [docs/visualizer.md](../docs/visualizer.md) "PIP mode". The only remainder is **Arena mode, which is deferred indefinitely** — so the fold-in debt is paid and this folder is drainable whenever Arena's plan is judged worth keeping only in `archive/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [web-search-providers](web-search-providers/web-search-providers.md)                            | Charter  | Selectable web-search engine for the openai-compat provider settings panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Open work

Legend: 🔴 bug · 🟡 feature/enhancement · 🔵 investigation or decision · ⚪ unbuilt charter tail

### Editor & code intelligence

- 🟡 **"Explain this to me" over a selection (AI, read-only).** The first AI action in the editor
  toolbar; uses `controller.getSelection()` (`editor-core.ts:501`). Needs a provider-neutral daemon
  "explain snippet" capability streamed into a side panel or sheet. Not Refine — read-only. Open:
  render target, throwaway vs real turn, how much surrounding context. Shares the focused-controller
  dispatch path with the shortcut overhaul's deferred "Full" stage.
- 🟡 **LSP: a live pass over the editor path and the Daemon → Code screen.** Every test is
  daemon-side or type-level; the UI itself has never been clicked through. **Never run the test
  suite against a live daemon.** Architecture: [docs/code-intelligence.md](../docs/code-intelligence.md).
- ⚪ **LSP Phase 4 (Angular / second server per document)** — deferred indefinitely. The multi-server
  binding it existed to prove now has a real production user in the `oxlint` row.
- 🟡 **Refine: the conflict-path integration test.** The `stale` phase writes nothing on conflict —
  written and typed, untested. Plus i18n. **Correction (integrated QA, 2026-07-25):** the Context
  Management call site this entry also listed **is built** — `ContextRefineAction`
  (`app/src/context-management/refine-action.tsx`, mounted at `context-management/panel.tsx:367`)
  opens the job with the selected file as the only rewritable path and the rest of the context graph
  as budgeted read-only references. It does not work end-to-end today; see the job-tab retarget row
  below. _(Charter drained 2026-07-25 — architecture in [docs/refine.md](../docs/refine.md).)_
- ⚪ **Refine: the four deferrals, in the order a user would notice them.**
  (a) **Add a file to the set from inside the tab.** Today the working set is whatever the opening
  surface seeded; the chips change a file's _role_ but cannot introduce a new file. A picker is what
  would make the editor entry as useful as the Context one.
  (b) **Selection-scoped refine.** Still the thing that would make Context Management's
  "demote a rule to a subdirectory" tractable, and the other half of a read-only
  "explain this selection" (see the explain-selection row above — `useRefineSession` already exposes
  `accept` as the only writing method, so a read-only host is the same session minus a button).
  (c) **A cost estimate in the instruction bar**, now that a hard 120K-character ceiling exists —
  the ceiling is the floor of the guard, not the guard.
  (d) **Streaming output**, which needs a streaming variant of the one-shot generation primitive
  that does not exist; and **round history**, where it is still unclear anyone wants stepping back a
  round over just re-running.
  **Do not "fix" the prose-only gate as part of any of these** — `refine-scope.ts` is deliberate and
  [docs/refine.md](../docs/refine.md) says why.
- 🔴 **Re-opening a job tab never refreshes what the job was set up with.**
  `findExistingTabForTarget` matches an open tab by deterministic id **or** target equality, and
  `updateExistingTabTarget` then skips the replace when `workspaceTabTargetsEqual` says the same
  thing (`app/src/stores/workspace-layout-actions.ts:1118-1143`). For every kind whose identity is
  its whole payload — refine (`paths[0]` only), fileHistory, contextManagement, orchestrationGraph —
  those two predicates are the _same_ test, so the second open can only ever focus the first tab.
  File tabs are the exception that shows the inconsistency: their id ignores lines while their
  equality includes them, which is why jump-to-line retargets correctly.
  **Repro:** open `CLAUDE.md`, press Refine in the file toolbar (single file, no preset, no
  references) → then in Context Management select `CLAUDE.md` and press **Compact with AI**. The tab
  focuses and nothing else happens: no references, no seeded instruction. Reverse the order and the
  file toolbar's "single-file counterpart" silently hands you the multi-file job instead. Refine's
  own identity comment states the intended behaviour — _"a re-request is a fresh pin of the same
  job"_ — so the design and the implementation disagree.
  **Not fixed deliberately:** there are three candidate fix sites (a payload-equality predicate used
  only by `updateExistingTabTarget`, a per-kind "refreshable fields" rule, or a `retargetTab` call
  from `openRefineTab`), and picking one is a decision about which target fields are identity and
  which are settings. Read-verified across all three functions; not executed.
- 🔵 **Workspace tab targets are coerced in two places, and they had already drifted.**
  `workspace-layout-store` (the live tab system) restores through `normalizeWorkspaceTabTarget`;
  `workspace-tabs-store` keeps a hand-written `coerceWorkspaceTabTarget` that has to be extended per
  kind. `fileHistory` was missing from it, so any persisted file-history tab was silently dropped by
  that store's `migrate`. Fixed 2026-07-25 with a regression test pinning all four job-tab kinds
  (`state.test.ts` — "restores every job-tab kind"). Latent rather than user-visible: `migrate` only
  runs on a version bump, and the four remaining consumers of that store do not read job tabs. The
  open question is whether the second coercer should exist at all.
- 🔵 **Verify caret auto-scroll follow + search-match-scroll.** Both marked fixed but carry "verify on
  the live repro across plain and split mode before closing."
- 🟡 **ctags fallback: incremental re-index.** Build once, then re-index only the written file (the
  write path already knows the path) instead of invalidating the workspace. Removes the latency
  complaint for the no-server case.
- ✅ **Solution view, Phases 0 and 1.** Built 2026-07-25. The read-only Solution lens, the
  `OttoDotnetProbe` sidecar (`packages/dotnet-probe/`, 257 KB portable IL), the daemon subsystem
  (`packages/server/src/server/solution-model/`), three `code.solution.*` RPCs behind
  `features.solutionView`, and the "Microsoft .NET Solution Management" switch — a separate row from
  Code Intelligence, **default off**, and off does no work. Architecture:
  [docs/solution-view.md](../docs/solution-view.md).
  **Phase 0's remaining open question is answered by measurement:** raw `Microsoft.Build` evaluation
  beats Buildalyzer 9.0 — 33× faster on a 12-project solution, 70× smaller, one runtime major lower,
  and more correct for a file tree (a design-time build reports generated `obj/*.AssemblyInfo.cs` as
  sources). Numbers in [packages/dotnet-probe/README.md](../packages/dotnet-probe/README.md).
- 🔵 **Solution view: a live pass over the lens.** Same shape as the LSP item above — every test is
  daemon-side, type-level, or against the pure row builder, plus six end-to-end against the real
  sidecar. The switcher, the picker, the tree and the failed-project tooltip have never been clicked
  through. **Never run the test suite against a live daemon.**
- ⚪ **Solution view: the client probes on the capability flag, not on the host's switch.** The
  daemon's half of "disabled is genuinely off" holds exactly as documented — `SolutionService`
  checks one boolean before any walk, read, parse, process, cache or watcher, and `service.test.ts`
  pins it against a provider spy. The client half is looser: `useSolutionsQuery` is gated on
  `features.solutionView`, which `websocket-server.ts:1514` sets unconditionally to `true`, so with
  `dotnetSolutionManagement` **off** every workspace still issues a `code.solution.list` round trip
  (5-minute staleness) to be told `[]`. Nothing spawns and nothing walks, so the cost policy is not
  violated — but it is one avoidable no-op RPC per workspace, and it lands in the same place as the
  "navigation refetches state the client already holds" row under [Performance](#performance).
  Closing it means the client learning the host setting, which it does not fetch outside Settings.
- ⚪ **Solution view Phase 2 — `.csproj` explicit-item membership.** _This entry used to read "Otto
  has no file create, delete, rename or move RPC at all" and was filed as .NET work. It was neither:
  the missing RPCs were a Files-lens gap that merely happened to block this row, and they are now
  **built** — `file.create`/`file.delete`/`file.rename` behind `features.fileMutations`, see
  [docs/file-mutations.md](../docs/file-mutations.md)._ With that prerequisite gone, SDK-style
  projects are already correct: membership is implicit, so creating a `.cs` file _is_ adding it to
  the project, and the Files lens now does exactly that. What remains is the minority case —
  explicit-item projects, where add/remove means editing the project file's item list. The daemon
  already reports which items are implicit (`SolutionProjectNode.isImplicit`), so they are
  detectable; the missing piece is a write path through the sidecar, which has no mutation verb today
  (see Phase 3).
- ⚪ **A rename does not retarget an open editor tab.** Falling out of the file-mutation work above:
  renaming or deleting a file that is open in a tab leaves the tab pointing at the old path. The
  watcher reports the disappearance so the editor shows its deleted-file state, which is honest but
  not helpful; re-pointing open tabs at a moved file is unbuilt.
- ⚪ **Solution view Phase 3 — solution and project mutations.** Add/remove a project, manage solution
  folders, new project from template, references and packages. **Via SolutionPersistence's writer,
  which round-trips both formats** — `.sln`/`.slnx` are never written by hand. The sidecar has no
  mutation verb today, deliberately; Phase 3 is where one is added.
- ⚪ **Solution view Phase 4 — pin `csharp-ls` to the selected solution.** `csharp-ls` accepts
  `--solution`; today `rootPath` is just the workspace `cwd`, so in a repo with two solutions the
  server picks one on its own and we cannot tell which. The client already remembers the user's
  choice (`explorerSolutionByCheckout`), so what remains is a registry extension: `args` are static
  per row (`lsp/registry.ts`), with no mechanism for per-workspace dynamic arguments.
- ⚪ **Solution view: solution filters (`.slnf`).** Explicitly out of scope for Phase 1. Listed so
  nobody assumes they work.
- ⚪ **Text editor: the four deferrals left when the charter drained.** (a) The **word-under-cursor
  bridge and picker are not wired**, so go-to-definition's daemon and client halves ship without an
  editor entry point. (b) **Gutter touch line-range selection**, which the charter called a hard
  mobile requirement. (c) **Direct auto-spawn** from the refactor dialog, withheld in Phase 5 in
  favour of a pre-filled draft. (d) **Completion to diff.** Architecture:
  [docs/text-editor.md](../docs/text-editor.md).
- ⚪ **Gated multi-root: Phase 3.** Phases 0, 1, 2 and 4 shipped in v0.5.8, reworked to
  preview-any-file plus an edit gate. Phase 3 (defence in depth) was deferred; the current posture
  is OS-permissions-as-boundary for single-file operations.

### File rendering

_The `file-rendering` charter drained 2026-07-25. Mermaid, AsciiDoc and relative image resolution all
shipped; the durable rules live in [docs/markdown-rendering.md](../docs/markdown-rendering.md). What
follows is everything that charter had left._

- 🔵 **The image viewer shipped 2026-07-26 — fit/zoom/pan, checkerboard, pixel size.** Images and
  binaries were already preview-only (`editorAllowed` withholds the mode bar for any non-text
  `kind`); what was missing was the viewer itself, which rendered every image into a fixed 420 px
  box. Now `components/image-preview.tsx`, with the natural size parsed from the container header
  (`image-dimensions.ts`) and the zoom ladder in `image-zoom.ts`, both unit-tested. Rules in
  [docs/text-editor.md](../docs/text-editor.md#the-image-viewer). **Two known gaps, both
  deliberate:** no pinch-to-zoom on native (it needs a gesture-handler pinch composed with two
  nested scroll views, and the ± buttons work), and no size cap on the read — see the daemon note
  below, which this feature makes easier to hit rather than causing.
- 🟡 **Single-file reads have no size cap, anywhere.** `file-explorer/service.ts` reads whole files
  into memory with a bare `readFile` and ships them whole; the only ceiling in the stack is the
  client-side 8 MB guard in `workspace-image-cache.ts`, which covers markdown-embedded images only,
  not file tabs. Opening a multi-GB binary in a file tab is a daemon-side OOM waiting to happen.
  The fix belongs on the read path (refuse past a threshold, report the size), not in the viewer.
- 🟡 **CSV/TSV table view.** Client-side parse plus virtualized rows (the explorer's FlatList
  patterns), with a toggle between table and raw text. `test-documents/data.csv` and `data.tsv` are
  the fixtures already waiting for it. Moderate.
- 🟡 **Jupyter notebooks (`.ipynb`).** JSON parse → markdown cells through `MarkdownRenderer`, code
  cells through `HighlightedCodeBlock`, base64 image outputs through the existing image path, text
  outputs as code blocks. Fixture: `test-documents/notebook.ipynb`. Moderate, and the highest
  perceived value of what remains.
- 🟡 **GitHub alerts.** `> [!NOTE]` / `[!WARNING]` / `[!TIP]` blockquotes render their literal marker
  text today. A token-level markdown-it rule mapping the five kinds onto themed callouts lights up
  chat and viewer at once, the way `task-lists.ts` did. Common in READMEs, so worth more than its
  size suggests.
- 🟡 **HTML `<table>`.** No markdown translation yet, so it unwraps to its cell text — legible, not
  broken, and deliberately so. Translating it to a GFM table is the obvious next tag; the AsciiDoc
  converter's `renderTable` already shows the shape.
- 🟡 **Icon or interactive checkboxes**, replacing the read-only ☐/☑ glyphs task lists render.
- ⚪ **Footnotes.**
- ⚪ **Math (KaTeX).** Feasible on web; native needs the webview approach, and the mermaid payload
  (`components/markdown/mermaid/webview/`) is now the pattern to copy — it already bundles katex.
- ⚪ **Mermaid polish:** pan/zoom for diagrams wider than the pane, and a source/diagram toggle.
- ⚪ **PDF — deferred.** The one genuinely heavy item: pdf.js on web, a separate native library, large
  payloads.
- 🔵 **Chat's image resolver stays separate — a correction to the drained charter.** The charter said
  chat had no workspace image path. It does, and always did: `utils/assistant-image-source.ts` +
  `AssistantMarkdownImage` (`message.tsx`) resolve an agent-authored `![](screenshots/out.png)`
  through the same `readFile` → attachment-store transport the viewer now uses. The two look like
  duplicates and must not be merged: chat's is deliberately **unbounded** (it falls back to the
  filesystem, drive or home root, because agents screenshot to `/tmp` and `~/.otto`), while the
  viewer's refuses anything outside the workspace, because a repo document is untrusted input. The
  contrast is written up in
  [docs/markdown-rendering.md](../docs/markdown-rendering.md#two-resolvers-on-purpose--do-not-unify-them).
  Chat's HTML `<img>` half remains off for an unrelated reason: `enableHtmlish={false}`.
- 🟡 **Tool-call cards render MCP results as raw JSON — they should show the result content.** The
  tool-detail parser (`deriveClaudeToolDetail`, `providers/claude/tool-call-detail-parser.ts`) types
  only the core CLI tools (shell / read / write / edit / search / fetch / sub-agent / skill); every
  **MCP** tool — all of Otto's own `mcp__otto__*` (browser\_\*, preview\_\*, terminal) plus any
  third-party server — falls into `unknown` and is `JSON.stringify`'d in the card
  (`components/tool-call-details.tsx` `buildUnknownSections`). The visible casualty is
  `browser_screenshot`: its card shows `[image]{…json…}` while the picture only appears in the
  separate assistant-image preview (whose **0×0 collapse was fixed 2026-07-26, uncommitted** —
  `message.tsx` `AssistantMarkdownResolvedImage` now measures its laid-out width via `onLayout` and
  sets an explicit height instead of relying on `aspectRatio` against an indefinite `width:"100%"`).
  **The fix is the widgets pattern, not a new `ToolCallDetail` variant:** a tool attaches a typed
  result-preview (an image ref first; structured summaries later) to the tool call's `metadata`
  (`z.record`, so old clients pass it through untouched — see `protocol/src/widgets/types.ts` for why
  a discriminated-union variant would break parsing of the whole timeline). Start with screenshots
  (image ref → reuse `AssistantMarkdownImage`), provider-neutral so Codex/Pi tool-result images ride
  the same channel.

### Git, changes & comments

- 🟡 **Resolved vs unresolved PR comments.** Approved counts, unresolved/total, mark-resolved,
  comment → task. GitHub resolution lives on review threads (GraphQL `isResolved`), absent from the
  REST comment list. Capability bit first, GitHub as proof.
- 🔵 **Comment behaviour across workspace operations is undefined.** Needs a decision, not a fix.
- 🔴 **Can't re-read your own file comments after sending.** Reopening the comment tile should show
  its contents. Marked not critical.
- 🔵 **Changes-view base: the auto-fetch decision and the non-worktree override.** Fork-point base
  resolution and the per-worktree override shipped; semantics live in
  [docs/changes-view.md](../docs/changes-view.md). Left: (a) **product decision** — does a read-only
  view get a throttled background `git fetch` of the base? Without one, a base ref nobody updates
  stays stale and merge-base math cannot help. (b) Plain checkouts have nowhere to store a base
  override — needs a second store keyed by workspace, and that store would have to feed
  `resolveBaseRefForCwd` or the base stops being one source of truth. (c) Polish: suggest a detected
  stacked parent in the picker; a "base is N behind origin" hint chip, which depends on (a).
- ⚪ **Git hosting: GitLab and beyond.** The provider-neutral forge layer supports GitHub and
  Bitbucket Cloud. Deferred until a GitLab user exists.
- ⚪ **Git file history: presentation.** The capability shipped; what remains is a side pane, gutter
  blame, and the mobile treatment.
- ⚪ **History delete: multi-select.** Per-row delete and bulk **Clear archived** shipped 2026-07-25
  ([docs/chat-lifecycle.md § Delete](../docs/chat-lifecycle.md#delete)). What is missing is the middle
  ground — selecting specific archived rows and deleting that set. It needs the
  `history.agents.delete.request` RPC the charter sketched (explicit ids, per-item outcome), which was
  **deliberately not built** because an RPC with no caller is dead protocol surface. Build the
  selection UI and the RPC together or neither.
- ⚪ **History delete: automatic retention.** A daemon config `historyRetentionDays`, **default off** —
  Otto should never silently delete a user's history — hot-reloadable via `MutableDaemonConfig` like
  rate-limit-warnings/speech, with a settings row. The sweep it would drive
  (`history.agents.clear_archived`, with `olderThanDays` already on the wire) exists, so this is a
  config surface plus a timer. Motivating cost is startup latency, not disk: `AgentStorage.load()`
  reads **every** `agents/**/*.json` into memory at daemon start with no age filter, so a large archive
  is a permanent boot and RAM tax.
- 🔵 **Cross-client delete propagation.** `agent_deleted` is emitted on the requesting session only
  (`this.emit`), same as it always was — another connected client keeps the row until it refetches.
  Archive propagates globally; delete does not. Noticed while wiring delete, not caused by it. Decide
  whether delete should broadcast the way `runs.cleared.notification` does.

### Subagents & background tasks

- 🔵 **Possible double-counting of background tasks and subagents.** Check whether a provider emits
  one unit into both `backgroundShellTasks` and the subagents track.
- 🔴 **A research personality paused for plan approval instead of returning its result.** The subagent
  hit `ExitPlanMode`, got approval, then stopped rather than handing its report up. A research-role
  personality probably should not have the plan-exit tool in scope.
- 🟡 **Promote an unattended run on a guardrail denial, and emit a denial timeline entry.** Closes a
  `TODO(safe-unattended Phase 3)` in `agent-manager.ts` (~L4108). Daemon-only. Two verified gaps: a
  guardrail denial does not promote the run the way a hard error does, and no denial entry reaches
  the timeline. Detail: `archive/projects/todos/unattended-denial-promote.md`.
- ⚪ **Observed subagents: the remaining provider adapters.** Claude is the shipped reference; the
  3-step adapter contract is in [docs/subagent-accounting.md](../docs/subagent-accounting.md).
  Sequenced behind the upstream merge — see [Build order](#build-order).
- 🟡 **Workflow decomposition: the four refinements the disk-tailing build left open.** Path B
  shipped and is live-verified (a 3-agent RGB fan-out decomposed into one `Workflow:` row with three
  nested children); architecture in
  [docs/subagent-accounting.md](../docs/subagent-accounting.md#workflow-decomposition-a-synthetic-event-source).
  What remains, none of it blocking:
  (a) **Phase grouping** — `wf_<id>.json` carries `phases` / `workflowProgress`, which the watcher
  reads but nothing surfaces as track or Visualizer grouping;
  (b) **Nicer titles** — the live title is the per-agent prompt, because the pretty script `label`
  is end-only and the row title freezes at first announce;
  (c) **Per-agent error granularity** — the live settle is always `idle`; an individual failure only
  surfaces through the run-state at reconcile, so a transcript-level failing signal is the refinement;
  (d) **Archived-run rebuild** — the reconcile already reads on-disk state, so "reconstruct this
  archived workflow" is cheap to add. It is a product question, not a cost one: observed rows are
  ephemeral by design, and this would be the first thing to break that.
  Also open, and larger: **nested workflow agents** (an internal `agent()` that itself fans out)
  currently have no decided shape — flatten under the workflow row, or preserve depth via the
  existing `observedParentKeyByToolUseId` chain. Leaning preserve, since the primitive exists.
- 🔵 **Replace the workflow watcher's hand-rolled tailing with the SDK's session-store APIs.**
  Claude Agent SDK ≥ 0.3.212 has `getSubagentMessages(sessionId, agentId)` / `listSubagents(sessionId)`,
  and `SessionMessage` now carries `parent_agent_id`. They are poll-style reads, not a push stream,
  so they do not replace the watcher outright — but they would retire its JSONL parsing and its
  inferred parentage. Keep the watcher's shape for any provider without session-store APIs.
- ⚪ **Safe unattended: Phase 4, the openai-compat responder.** Phases 0 to 3 shipped in
  `e9dc9c34b` (`dontAsk` posture, per-model Auto eligibility). Phase 4 is the openai-compat
  responder over read/interact/execute, plus the other providers. Architecture:
  [docs/safe-unattended.md](../docs/safe-unattended.md).
- 🔵 **Safe unattended: internal-vs-listed agent visibility.** Phase 3 accepted internal and
  ephemeral schedule runs as they are: run rows are not re-openable, and the agents are gone after a
  restart. Marked for review rather than decided.
- 🔵 **The subagents-cleanup pass never got its formal live verify.** All six charter items shipped
  2026-07-13 in `7f9b179e2`, but step 6 (a full live end-to-end run over the track: status-aware
  actions, frozen names, per-row cost, the Completed group and "Clear all") was never formally
  executed. The track has been reworked since (liveness signals, auto-clear), so the gap may be
  stale rather than real. Rules are in
  [docs/chat-lifecycle.md § Row actions, names, and cost](../docs/chat-lifecycle.md#row-actions-names-and-cost).
- 🟡 **Suggested Tasks: the wire and i18n tails.** `started` and `dismissed` states are not on the
  wire (pending-only today), the settings row and card are hardcoded English, and a dedicated tool
  group was deferred. Card persistence across restart is covered under Onboarding & UX above.

### Visualizer

- 🔴 **Actions disappear while still running.** A long bash/read/write shows, hides, then reappears on
  completion. Suspected fixed-TTL node versus a lifecycle tied to the tool call.
- 🟡 **Discoveries should fade; their colours read as wrong or unexplained.**
- 🟡 **Skill activation is not shown at all.** No node or badge when a skill fires.
- 🔵 **Live-verify the context ring and the discovery cards on a real Claude session.** Both are
  covered by pure-mapper unit tests and by the vendor's own render subsystem, but neither has been
  watched on canvas against a real run — canvas pixels are unassertable, so the bridge-log loop in
  [docs/visualizer.md § Debugging](../docs/visualizer.md#debugging--iterating-fastest-loop) is the
  only check. The **discovery-noise question rides with it**: the derivation excludes Read and
  `sub_agent` and nothing else, with no per-node cap or rate limit, so whether a burst of Greps and
  Edits sprays cards is a live-observation question, not a code-reading one. A per-node cap is the
  next lever if it does; widening the exclusions is not.
  _(Charter drained 2026-07-25 — architecture in [docs/visualizer.md](../docs/visualizer.md),
  "Context ring" and "Discovery cards".)_
- ✅ **The context-composition ring.** Built 2026-07-25 (uncommitted). Unified onto the provider's
  own accounting — `AgentUsage.contextCategories`, the same reading
  `agent.context.get_usage` serves the context meter, so the graph and the meter can no longer
  disagree. Open-ended labels, not a 5-way enum. Claude + openai-compat report a real split; Codex,
  Copilot and OpenCode report occupancy only and stay on the daemon's timeline estimate.
  See [docs/visualizer.md](../docs/visualizer.md) "Context ring".
  **Correction:** this does _not_ share instrumentation with the usage log's View B — see that entry.

### Performance

- ✅ **Resource reporting.** Built 2026-07-25 — `packages/app/src/diagnostics/resource-report/`:
  frame timing, a retained-state census over every store, react-query cache and DOM counts, live
  timer counts, and daemon-traffic accounting (including main-thread handler time). Surfaced live
  along the bottom of the Metrics screen, in the app diagnostic report, and to the soak harness via
  `window.__ottoResourceMonitor`. Off switch: `Settings › Diagnostics › Performance monitoring`.
  Soak: `packages/app/e2e/client-resource-soak.spec.ts` (`OTTO_RESOURCE_SOAK_E2E=1`). Documented in
  [docs/client-performance.md](../docs/client-performance.md).
- 🟡 **The performance-monitoring off switch does not uninstall the timer patch.** `installRuntimeCounters`
  wraps global `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval` from `resourceMonitor.start()`
  (`app/src/diagnostics/resource-report/runtime-counters.ts`), and there is **no uninstall path** —
  only `resetRuntimeCountersForTest`. `ResourceMonitorHost` turning the setting off calls
  `resourceMonitor.stop()`, which clears the census interval and the rAF chain but leaves the wrappers
  and their two live handle `Set`s in place for the rest of the process. So the instrument that exists
  to measure overhead keeps a permanent hook on the app's hottest scheduling path even when the user
  has said no. **Measured, so it is not overstated:** the wrapper costs ~1.57× native on
  schedule-then-clear — 0.375 µs vs 0.239 µs per op on this machine, i.e. ~27 ms per 200,000 timer
  pairs. Small in absolute terms; the defect is that the switch is not honest, not that it is slow.
  Fixing it means keeping the natives and restoring them, and deciding what happens if something else
  patched on top in the meantime.
- 🔴 **App-wide FPS degrades over time — measured, not yet fixed.** Findings in
  [docs/client-performance.md](../docs/client-performance.md#what-the-client-actually-does-with-resources).
  Retired by measurement: timer leak, query-cache growth, observer leak, message-decode cost (0.25%
  of wall clock). **Correction 2026-07-25:** the headline that followed — "mounted workspace trees
  are never released, 1 → 3 workspaces costs ~35% of the frame rate" — **is withdrawn on both
  halves** (row below). No confirmed cause remains for the reported symptom; the live candidate is
  render cost per inbound daemon message, below.
- ✅ **Workspace-tree retention — verified, nothing to build.** Answered 2026-07-25 by re-running the
  soak above the cap (6 workspaces, 12 cycles, two runs per cap value at 1 / 3 / 6):
  [findings/client-performance/2026-07-25-workspace-tree-retention.md](../findings/client-performance/2026-07-25-workspace-tree-retention.md).
  **Eviction fires and fully releases the tree** — mounted trees flat at 3 while six workspaces were
  visited, `query.observers` plateaued at the 3-tree cost, and the released queries showed up as
  `query.unobserved`. Retention is bounded by the cap, not by workspaces-visited. **The −35% frame
  cost is withdrawn too:** it came from `Client frame drift`, whose decile bucket is one sample at 12
  cycles — the same configuration produced both verdicts on consecutive runs, and it reported
  "degraded" at a cap of 1, where retention is provably constant. Nothing was changed in the app; the
  harness gained `OTTO_RESOURCE_SOAK_WORKSPACES`, a mounted-tree count and a switch-back timer, and
  `docs/client-performance.md` gained the two invariants this cost.
- ✅ **The mounted-workspace cap is a setting.** Built 2026-07-25, closing the entry that asked for
  it. `mountedWorkspaceLimit` — device-local, **default 5**, clamped 2–12 — surfaced as
  Settings › General › _Workspaces kept loaded_ and consumed by the workspace deck via a narrow
  `useAppSettingValue` subscription, so lowering it releases the excess trees on the next render
  rather than at the next switch. `WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES` is **gone**:
  `maxMountedWorkspaces` is a required argument and the pure module holds no default, because a
  fallback constant there would be a second cap able to disagree with Settings.
  **Why it mattered**, from real usage: _"At work I need 8 projects and each one has 1 workspace. I
  don't use them ALL but often use 4 at once."_ With 4 in rotation and a cap of 3, every switch
  evicts the tree the user is about to return to — LRU thrashing with the cap one short of the
  working set, close to the worst possible value.
  **Default justified by measurement, not by a round number:** anything below 4 thrashes that
  rotation, and 5 covers it with one spare. The two extra trees over the old 3 cost +118 to +236
  observers and +152 to +338 DOM nodes — one resident tree is +59 to +118 observers and +76 to +169
  DOM nodes, a **range** depending on what that workspace has open — and no frame rate the soak can
  resolve (3 → 6 sits inside run-to-run noise). So the trade-off is **memory, not smoothness**, and
  the user-facing description says so.
  **Two caveats that survive.** Switch-back to a _resident_ tree measured no faster than a cold mount
  (356ms vs 298ms median), but that timer stops when the panel is **painted** and a cold mount paints
  before its timeline refetch lands — the latency win retention is supposed to buy still needs a
  usable-not-painted measure. And the soak drives idle agents, so it never exercises
  `push rate × mounted subscriber count` — the row below.
  Storage layer (`AppSettings` field, clamp, `parseMountedWorkspaceLimit`, and the 5/2/12 bounds)
  came from a concurrent session and was consumed unmodified; that session has since corrected its
  doc comment to match the measurement.
- ✅ **A conversation corpus to measure "a lot is open" against.** Built 2026-07-28. Every existing
  performance instrument drives empty workspaces with idle agents, which is why none of them has ever
  reproduced the reported symptom. The corpus is a synthetic heavy install: **6 projects x 4
  workspaces x 12 chats x (10 turns x 30 items) = 288 chats, ~86k timeline items, seeded in 4m10s**
  at concurrency 24. Seeding logic is one module (`scripts/perf-corpus.mjs`) with two callers —
  `scripts/seed-perf-corpus.mjs` puts it in the dev daemon to be opened by hand, and
  `packages/app/e2e/perf-corpus-soak.spec.ts` (`OTTO_CORPUS_SOAK_E2E=1`) measures against it. The
  sharing is the point, the same as the boilerplate-project corpus: a soak number has to describe the
  state a human just clicked through. Method and the four load-bearing corpus properties are in
  [docs/client-performance.md](../docs/client-performance.md#the-conversation-corpus-for-the-a-lot-is-open-case).
  **Two defects found and fixed while building it, both of which would have quietly invalidated
  results:** the provider seeded its generator from a per-turn UUID, so no corpus was reproducible
  across runs and an A/B measurement would have compared two different corpora (fixed with a
  `synthetic-seed:` directive, pinned by test); and `refName` on a `branch-off` worktree is the
  **base** branch, not the new branch name, while the protocol comment said the opposite (comment
  corrected). **Not yet run at scale** — the soak is written and typechecks, but the numbers it
  produces are the next row, not this one.
- ✅ **Workspace switching measured against a loaded corpus — and reported fast in real use.**
  Measured 2026-07-29 by driving the dev build by hand (one lane, one tab) against verified-populated
  chats, both panels open with the Changes view loading per switch. **Warm switch ~485ms; cold mount
  ~1.3–1.9s to a usable Changes list, of which ~68% is blocked main-thread JS, including a single
  700–850ms synchronous task.** Retention is worth roughly 4x, so the deck cap earns its keep.
  DOM runs ~8–15k nodes per mounted loaded workspace (~35k at four).
  **The negative result is the useful one: repository size does not drive switch cost.** A 3,012-file
  repo with 40 changed files cold-mounted no slower than an 8-file one (961/1303ms vs
  1147–1696ms) — the difference is noise. Switch cost tracks the app's React mount work, not git.
  **Numbers are from a dev build with optimizations off**, so treat the ratios as the finding and the
  absolutes as an upper bound; the profile's top frames were React DEV paths (`jsxDEV`, `createTask`,
  `runWithFiberInDEV`) that do not exist in production.
  **Real-world outcome:** after the .NET process door (`1bfa698b2`) and active-workspace git
  observation (`8344e43da`), a full day of use on real work repos reported switching as "very fast
  again". Both fixes were already in the measured build, so the numbers above are what remains after
  them. Nothing measured looked pathological; **treat this as closed unless it regresses.**
- 🔵 **Untested dimension: chats that run for hours.** The corpus tops out around 500 timeline rows
  per chat, and a real all-day session is far longer. Repo size is ruled out (above) and chat count
  per workspace is covered, so transcript _length_ is the last volume axis with no measurement behind
  it. `OTTO_CORPUS_TURNS`/`_ITEMS` drive it; note that seeding is ~1 turn/sec per chat, so a
  thousands-of-rows chat is minutes of seeding, and the daemon must not be restarted afterwards.
- 🟡 **Instrument render cost per inbound daemon message.** The one gap keeping "daemon volume is the
  bottleneck" alive: `traffic.handlerMs` covers decode, validate and dispatch, **not** the React
  re-render each store write triggers. Cost is plausibly `push rate × mounted subscriber count`.
  **Promoted 2026-07-25 to the only live mechanism** now that workspace-tree retention is out: the
  subscriber count is bounded by the deck cap, but the push rate is not, and the navigation-only soak
  drives idle agents so it has never exercised this at all. Needs its own instrument — this is not a
  question the existing soak can answer.
- ✅ **Navigation refetches state the client already holds.** Fixed 2026-07-25. Three redundant
  round-trips per workspace round-trip, all now at their floor of one per workspace visited:
  **`fetch_agent_timeline` 33 → 4**, **`workspace_setup_status` 38 → 4**, **`terminals_changed`
  51 → 4** over 12 navigation-only cycles across 4 workspaces; total inbound 232 → 99 messages and
  `traffic.handlerMs` 267ms → 130ms. (1) Focusing a chat pane fetched the timeline unconditionally —
  now gated on `shouldSyncAgentTimelineOnFocus`, which fetches only when history was never applied or
  the host reconnected since this agent last synced; the reducer's seq/epoch gate already covers
  gaps. (2) `ensureSetupStatus` cached only a positive answer, so "this workspace has no setup" was
  re-asked on every route focus — now cached, cleared by a progress push, workspace removal, or
  reconnect. (3) The terminals push subscription now lingers 15s past its last observer
  (`TERMINAL_SUBSCRIPTION_LINGER_MS`) so leaving and returning is a timer cancel, not an
  unsubscribe/subscribe pair — a debounce on churn, deliberately not a second retention policy
  competing with the deck's mounted set. Evidence:
  [findings](../findings/client-performance/2026-07-25-navigation-refetch-and-stream-retention.md).
- ✅ **`agentStreamTail`/`agentStreamHead` have no per-agent eviction.** Fixed 2026-07-25.
  **The release trigger, decided:** buffers are released when the agent is not being displayed AND
  either it has left the session (deleted, removed, archived) or it is past a cap of 12 agents,
  oldest-touched first (`timeline/agent-stream-retention.ts`). Two load-bearing parts: "not being
  displayed" is an explicit ref-counted retainer registered by every surface that renders the buffers
  (`useAgentStreamRetention`) — inferring it from focus or lifecycle blanks a mounted background pane;
  and releasing also drops `agentTimelineCursor` + `agentAuthoritativeHistoryApplied`, without which
  the next open is an `after` catch-up onto an empty tail. Archive released nothing before this, and
  the `agent_update{remove}` path cleared the cursor while leaving the tail as unreachable state.
  The Visualizer is unaffected — checked, not assumed: its backfill re-fetches from the daemon, not
  these buffers. **The cap is not soak-verified** (the soak seeds 4 agents against a cap of 12); it is
  covered by unit tests only, and the number itself was chosen, not measured — see the open row below.
- 🔵 **Is 12 the right stream-buffer cap?** Chosen as "more chats than a session realistically has
  open at once, far fewer than a day's worth of agents". Too low costs a `tail` refetch on reopen,
  too high costs retention; nothing measures the per-agent cost yet. Worth answering with the same
  instrument as the row above it, not in isolation.

### Onboarding & UX

- 🟡 **Vertical tab rail polish.** Five pull-offs: rail chip styling, cross-pane drag indicator,
  non-split desktop fallback, i18n extraction, on-device verification. Detail:
  `archive/projects/todos/vertical-tabs-rail-polish.md`.
- 🟡 **Themed avatar image set for agent teams.** The schema is already reserved and
  forward-compatible (`AgentTeamAvatarSchema.imageId`, where `imageId` wins over `color` and colour
  stays the fallback). Needs ~2 dozen keyed image assets, `imageId` rendered everywhere, and a picker
  grid in `agent-teams-section.tsx`. No protocol work. Detail:
  `archive/projects/todos/agent-teams-themed-avatars.md`.
- 🟡 **Bind a personality to a schedule from the client form.** The server side is fully shipped —
  a schedule config carries an optional `personality` and the run path re-resolves it per run. The
  client form has no personality field. **Settle the product decision first:** persisted re-resolve
  versus a one-time fill. Gate on `features.agentPersonalities`. Detail:
  `archive/projects/todos/schedule-form-personality-binding.md`.
- 🟡 **Widgets: the on-device pass.** Shipped 2026-07-25 (charter drained; architecture in
  [docs/widgets.md](../docs/widgets.md)). Every layer is typed and unit-tested, but the three
  sandboxes have not been clicked through: the Electron `<webview>` preload handshake, the web
  `MessagePort` transfer, and content-driven height on a phone (including the 420px collapse). Do
  this before widgets are defaulted on for everyone.
- 🔵 **Widgets: attribution for `sendPrompt`.** A widget-sent turn renders as an ordinary user
  message; today the only attribution is proximity — the user clicked something and a message
  appeared. A first-class "sent by a widget" marker on user messages is a protocol change and was
  deliberately not made. Decide whether it is worth one.
- 🔵 **Widgets: reopening the network question.** v1 ships `connect-src 'none'` with no CDN and no
  vendored libraries, so charts are hand-rolled SVG (a stated deviation from the charter's
  recommendation — reasons in [docs/widgets.md](../docs/widgets.md#network-none)). Reopening needs
  an asset origin that survives the relay, not a CDN allowlist. Not blocking.
- 🔴 **The Files module flashes an error referencing a stale URL.** Likely a cached query or path, or
  a persisted tab pointing at a dead path. Needs a repro.
- 🔵 **Do models volunteer suggested tasks at Claude Desktop's rate?** The trigger-first description
  rewrite fixed reachability; the open question is the unprompted call _rate_ in real use. If it is
  still low, the next lever is prompt-level guidance rather than more description text. Card
  persistence across daemon restart is separately deferred — in-memory by design.
- 🟡 **First-time wizard: Phase 3, the friendly half.** Phase 1 (storage plus gate) shipped
  2026-07-12; step order is Mode, Providers, Agents, Teams, Done. Phase 3 is design-led and each
  piece is its own decision: composer personality-first, chat-stream forced defaults, and the
  open-project / new-agent User-mode copy. **i18n extraction of all wizard, team, tier and gating
  strings is still owed**; they shipped as inline English.

### Providers & accounting

- ✅ **Total token accounting.** Shipped 2026-07-25. One honest number per chat: a per-agent lifetime
  in/cache/out split plus the provider's own de-inflated cost (`cumulativeUsage`,
  `COMPAT(cumulativeUsage)`), summed by one selector (`subagents/chat-totals.ts`) and surfaced in a
  chat metrics toolbar (`settings.chatMetricsBar`, off by default). The Visualizer's rate-table cost
  estimate is **gone** — cost is reported or blank. Rules in
  [docs/subagent-accounting.md § Chat totals](../docs/subagent-accounting.md#chat-totals-one-honest-number-per-chat);
  vocabulary in [docs/glossary.md](../docs/glossary.md). Remaining tail below.
- 🔵 **Should the in/out split be its own readout?** The daemon now carries the real
  in / cache-read / cache-write / out split per agent, but the toolbar collapses input to one figure
  and nothing surfaces the cache-read share — which is the number that explains why a long chat costs
  less than its token count suggests. The data is there; the presentation decision is not made.
- 🟡 **Reconcile the sub-agents track header with the chat total.** `formatHeaderLabel` still sums
  children only (parent excluded) — correct for a track header, but it now sits next to a toolbar
  showing a strictly larger number with no explanation of the difference.
- 🔵 **Verify the cumulative-reporter fix against real Pi and OpenCode hosts.** `toTurnSpend`'s
  per-provider scopes are unit-tested and were read off the provider adapters, but neither provider
  has been run live since. A wrong scope over-counts silently.
- 🔵 **Pinned metadata-generation providers silently fall through** when the provider cannot do a
  tool-less completion. Only `claude` and `openai-compat` implement `generateBareCompletion`; every
  other provider throws in `AgentManager.generateBareCompletion` (`agent-manager.ts:1794`) and the
  ladder moves on — by design. Consequence: a host that pins `metadataGeneration.providers` to such a
  provider gets its pin quietly bypassed and **another provider billed**. Confirmed live. Two angles:
  (a) product — should a pinned-but-incapable provider warn rather than silently re-route spend?
  (b) test harness — the mock provider has no `generateBareCompletion`, so **no E2E can pin metadata
  generation deterministically**, which makes the auto-title spec non-hermetic.
- 🟡 **The Preview workflow doctrine only reaches one provider.** `buildPreviewWorkflowPrompt`
  (`openai-compat-agent.ts`) injects the rules that make Preview work — start dev servers with
  `preview_start` and never a shell, verify only against the returned `browserId`, show proof instead
  of asking the user to look — but it is emitted by the openai-compat provider alone. Claude Code,
  Codex and the rest get the guardrail-bearing tool descriptions and none of the doctrine, which is a
  provider-parity gap of exactly the kind this fork exists to close. **Confirmed live:** a Claude Code
  agent asked to verify a UI change reached for `browser_new_tab` against a running Metro URL rather
  than `preview_start`, producing the detached unbound tab the tab-binding rule exists to prevent —
  and `findPreviewServerForUrl` did not catch it, because the server was never declared in
  `launch.json` and so was not in the guarded set. Descriptions alone do not steer; that was the
  finding that motivated `buildPreviewWorkflowPrompt` in the first place. Docs now cover the trap
  ([docs/preview.md § Servers Otto did not start](../docs/preview.md)), but docs are opt-in reading
  and the prompt is not.
- 🔵 **Should a schedule firing into a busy chat queue, fail, or skip?** The one part of
  system-injected delivery left open. It never interrupted — `executeSchedule` fails the run with
  "already has an active run" — and it cannot be flipped with a flag, because it uses the blocking
  `runAgent` to collect the run record while the queue dispatches fire-and-forget. Underneath is a
  product question: is a schedule a deadline or a task? The cheapest fix is probably recording the
  run as **skipped** rather than failed.
- 🟡 **Usage log: per-row context composition (View B).** Expanding a turn row would break down
  catalog / personality / team / `CLAUDE.md` contribution. Needs exact-injected instrumentation that
  does not exist yet. Also deferred: cursor pagination beyond "load more", and provider/kind filters.

  **Correction (2026-07-25):** this was recorded as sharing instrumentation with the Visualizer's
  context ring — "do that instrumentation once". That is wrong, and building it that way would have
  produced a breakdown that cannot answer View B's question. The ring's source is the **provider's**
  reported split, where everything Otto injects (catalog, personality, team, `CLAUDE.md`) is
  invisible inside one opaque "System prompt" bucket. View B needs Otto to instrument **its own
  prompt assembly** — a genuinely different measurement that no provider can report. What the ring
  work _does_ hand View B is the transport and the shape: `AgentContextCategory[]` is open-ended, so
  injection-level categories ride the existing field with no protocol change. Sequence View B behind
  the prompt-assembly instrumentation, not behind the ring.

- 🔵 **Personality memory: calibrate the injection budget.** `MEMORY_BRIEF_TOKEN_BUDGET` is 1,500 — a
  judgement call against a 200K default window, and ~4.7% of a 32K local model's. Context Management
  now _measures_ the figure per personality, so it can be tuned with evidence instead of argued.
  Architecture: [docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons).
- 🟡 **Personality memory: a smarter merge on transfer.** Transfer-on-delete merges near-duplicates
  lexically, like every other dedup in the subsystem. Asking the destination personality to reconcile
  two overlapping lessons is the natural extension of the `review_lessons` loop — the one place in
  this feature where a model is the right tool.
- ⚪ **Context Management: demote a rule to a subdirectory.** The one graph operation the charter
  named and did not build. It converts fixed → conditional weight by moving a **rule** — a span the
  user chooses — out of the root context file and into a subdirectory one. It is deliberately not a
  one-click button: content surgery needs a selection model that a read-mostly tree does not have,
  and the safe version of it is Refine with **selection scope** (above), not a bespoke edit. Sequence
  it behind that.
- ⚪ **Context Management: skills and MCP toggles.** The report already _measures_ both — per-skill
  description weight (the description is the fixed cost, the body is not) and MCP tool schemas.
  Turning them **off** is each its own subsystem: a skill needs a daemon skill registry with a write
  path, and MCP needs per-project MCP config editing, so the lever belongs with whichever subsystem
  owns that config rather than being smuggled into this tab.
  **Coordinate with [claude-extensions](claude-extensions/claude-extensions.md)** — that charter's
  always-on plugin cost budget describes the same consumption from the other direction, and the two
  must share a vocabulary and the unit (% of context window) rather than each inventing a
  presentation.
- 🔵 **Context Management: calibrate the estimate, and populate the real model window.** Two
  measurements the tab ships without.
  (a) **Token counts are chars/4.** The calibration is a differential measurement, and the harness
  for it already exists: the Claude provider supports a stripped agent (`settingSources: []`, no
  preset, no tools), so diffing its turn-one input tokens against a normal agent's gives **the real
  fixed tax**, per provider. A fixture repo (hard `@import`, markdown link, subdirectory context
  file, a cycle, a duplicate import) run against each CLI would additionally become a permanent
  regression test for when a CLI changes behaviour under us — including confirming duplicate-import
  dedup, which the deduplicated token total depends on.
  (b) **The window picker defaults to 200K rather than the active model's real window.** The daemon
  accepts one (`WorkspaceContextRuntime.windowTokens`); nothing populates it, because no
  provider-neutral model-window lookup exists. Never let this default to the largest preset — that
  reports "you're fine" to everyone.
  _(Charter drained 2026-07-25 — architecture in
  [docs/context-management.md](../docs/context-management.md).)_
- 🔵 **Context Management: dismissal is device-local, and cross-device sync was deferred, not
  forgotten.** The flyout's mute-with-key mirrors the client store's proven
  `rateLimitDismissKey` / `mutedUntil` shape, scoped per workspace. Server-side sync needs a new
  persisted daemon store; for a multi-device product it is the eventual answer.
- 🟡 **Token-cost audit: the remediation menu was never actioned.** The measured audit
  (2026-07-18) found that the Otto tool catalog costs about 9.7K tokens per request at 48 tools and
  about 14.9K at 74 with the browser on, on every request of every provider when
  `mcp.injectIntoAgents` is on; that all generations (title, branch, commit, PR, voice cues, run
  summary) are full agent spawns with no internal-agent exemption; and that
  `workspace-auto-name.ts:111-133` re-runs the whole ladder when the rename path yields null.
  Ranked fix #1 is an **internal-agent exemption from tool injection**: one gate, roughly 10K to 25K
  tokens saved per generation. The report itself belongs in [`findings/`](../findings/README.md),
  not in this tree.
- ⚪ **Token-cost fixes: per-category USD tiles and the aux category.** Captured but not rendered.
  The WP-G taxonomy was revised after review because the original grid mixed two partitions of the
  same tokens.

### Testing & tooling

- 🔴 **`send_agent_prompt` reports success for prompts that are silently dropped, and nothing tests
  agent-to-agent flows end to end.** A prompt sent to a busy agent lands in the steer queue; if that
  agent is archived or closed before the queue drains, the entry is discarded with no error, no
  notification and no dead letter, while the tool has already returned
  `{"success":true,"status":"running"}` at enqueue time. Three or four orphans accumulated in one
  session on 2026-07-28 with the sender reporting the work as in flight throughout. The drain lives
  in `agent-manager.ts` run finalization and is provider-agnostic, but it was only ever observed
  against a local `openai-compatible` agent, and that was also the first session driving
  agent-to-agent sends that way — **two variables changed at once, so establish which before
  fixing.** Charter, the three-part fix and the harness design:
  [agent-to-agent-flow-tests](./agent-to-agent-flow-tests/agent-to-agent-flow-tests.md). Every hop is
  covered today; the seam between hops is not, which is where this lived.
- 🔴 **`main` CI has not been green since 2026-07-12, and two releases were cut over it.** The last
  successful `CI` run on `main` is 2026-07-12; every run since is `failure` or `cancelled`, so both
  0.7.0 and 0.7.1 shipped over a red suite. The strict-deep-equal drift in
  `packages/client/src/index.test.ts` recurs every time a config key gains a schema `.default(...)`
  (most recently `attachmentImageMaxAgeDays` / `attachmentImageMaxTotalMb`); it is fixed again, but
  the pattern will keep biting until the expectation stops enumerating every defaulted key. **The
  real problem is that a red `main` stopped being treated as a signal** — nobody was reading the runs,
  so a 15-day outage looked like background noise.
- 🟡 **`mcp-server.test.ts` worktree-branch assertions assumed two independent writes were ordered.**
  The workspace record's `branch` and the worktree's actual git branch are written by _different_
  paths — the workspace-name generator upserts the record, the first-agent branch auto-namer renames
  git — so waiting on the record and then reading git immediately is a cross-path ordering assumption.
  It holds locally (121/121 across three full-file runs on Windows) and lost once under CI load,
  producing "registry says `generated-manual-race-title`, worktree says
  `feat/manual-title-placeholder`". Both affected assertions now poll the git branch they are actually
  about (`waitForWorktreeGitBranch`). **Not fully closed:** the failure never reproduced locally, so
  the ordering explanation is inferred from the code rather than observed. If it recurs, the next
  suspect is `attemptFirstAgentBranchAutoName` (`otto-worktree-service.ts:159`), which returns
  `renamed: true` unconditionally with `branchName: renamedBranch.currentBranch ?? targetName` —
  though a failed `git branch -m` rejects rather than resolving, so that does not explain it alone.
- 🟡 **E2E global setup called Metro ready when the port opened, not when the bundle was built.**
  `waitForServer` is a raw TCP connect, which Metro satisfies long before it has compiled the web
  bundle; the first navigation triggers the compile, and on CI that ran past a spec's 60s budget. Each
  shard spawns its own Metro, so whichever spec happened to be first in a shard paid for it and failed
  on `page.goto` — `diff-row-alignment` as attempt #1 in shard 2, and the same signature in shard 4.
  `global-setup.ts` now warms the bundle with a real navigation before any test runs. Distinct from
  the `test-results`/`ENOENT` Metro failure below, which kills an already-running bundler.
- 🔴 **Metro dies mid-E2E when Playwright churns `packages/app/test-results`.** Playwright's default
  `outputDir` sits **inside Metro's watched project root**, so deleting a scratch dir makes Metro's
  watcher throw `ENOENT`, the Expo CLI rethrow, and the bundler exit. Every later navigation then
  fails with `ERR_CONNECTION_REFUSED`, so specs report bogus navigation failures instead of their
  real result. Hits any second run in a checkout that still has artifacts on disk.
  **Workaround:** `E2E_OUTPUT_DIR=<path outside packages/app>`. **Real fix:** default `outputRoot`
  outside the Metro root, or add `test-results` to a Metro `blockList` — `packages/app` currently has
  no `metro.config.js`.
- 🟡 **E2E build-out.** Tiers 1 and 2 are green (all T1 batches, T2 local-AI 6/6); the coverage
  matrix and its drift guard (`scripts/e2e-coverage-check.mjs`) track the rest. Three known items
  remain: the scoped `personality-autosubmit-regression` rework, the Windows-only
  `git-cta-push-reconcile` limitation, and the deferred vision spec, which needs a vision-capable
  pinned model.
- ✅ **The coverage drift guard now runs itself.** _(Closed 2026-07-25.)_
  `client-resource-soak.spec.ts` had landed in `beb4b833a` without a matrix row, so 122 specs were
  claimed by 121 rows and `node scripts/e2e-coverage-check.mjs` exited 1. The row is added, and the
  guard runs in **CI's `lint` job** (`.github/workflows/ci.yml`) on every push and pull request —
  before `npm ci`, since it is pure file analysis and needs no dependencies, so it costs no runner
  and fails fast. CI rather than the pre-commit hook deliberately: the hook is shared by every
  parallel session in a working tree, and this check compares the whole spec directory against the
  whole matrix, so it could not have been scoped to staged files even if the contention risk were
  acceptable. This was the project's deferred Phase 1 "wire coverage check into CI" item.
  The soak went into a **new §16, "Performance instruments (measurement, not coverage)"**, marked
  📊 rather than ✅/🟡/❌: its only hard assertions are that the instrument produced a usable
  series, so counting it as coverage would claim a behaviour nobody tested. The check counts 📊
  separately and keeps it out of the percentage. **Left open, deliberately:**
  `terminal-performance` and `terminal-keystroke-stress` are the same shape — opt-in instruments
  behind `OTTO_TERMINAL_PERF_E2E=1` — but sit in §8 marked ✅, so §8's "100% covered" counts two
  specs that never run in CI. Moving them drops §8's ✅ count and re-buckets them in every future
  run report, so it is recorded rather than done in passing.
- 🟡 **Site demos: the scenario backlog.** The pipeline itself is shipped and documented
  ([docs/site-demos.md](../docs/site-demos.md)); what remains is content. In rough priority:
  (a) **A `demo:real` capture pass over 07-subagent-track / 08-visualizer / 09-composer-intelligence**
  — all three are written against the e2e selector helpers but their non-deterministic beats have not
  been validated. 09 has a known open problem: two real runs completed the turn but neither triggered
  `spawn_task`, so the task-chip beat never fired. That looks like more than ordinary
  non-determinism, since the deliberate out-of-scope TODO lives in `routes/events.js` while the
  prompt scopes the agent to `routes/health.js` — the agent may simply never read the file with the
  bug. Narrow the prompt or move the TODO **before** spending more real-run tokens on retries.
  (b) **Unbuilt scenarios**, cheapest first: `11-homepage-tour`, `12-themes` (which is where Neotokyo
  lives now), `13-artifacts` and `14-schedules` (both free _if_ the seeder plants the files),
  `15-workspace-layouts`, then `16-terminals`, `17-multi-provider`, `18-worktrees`, `19-editor-ide`.
  Two remain storyboards only: `01-agent-live` and `10-diff-ai-review`.
  **The demand side is now written down:**
  [marketing-strategy/website-showcase.md](marketing-strategy/website-showcase.md) maps the landing
  page's eleven sections to a 35-shot manifest and names the producing scenario for each, so what
  the site needs and what the pipeline builds stay one list. It adds `00-website-hero` (a curated
  full-frame **looping** capture that absorbs `hero-shot`, plus a content-curation pass on the
  `mango-storefront` template, whose filenames and comments are site copy), and five scenarios the
  backlog above never named: `20-context-cost`, `21-voice`, `22-widgets`, `23-orchestration-runs`,
  `24-code-intelligence`, `25-git-history`. Twelve of the 35 shots already have a producer. Cheapest
  win in the table: `model-local-verify` is `02-preview-verify` re-run with
  `DEMO_PROVIDER=local-ai` — no authoring, one run, and it is the proof that preview verification is
  not Claude-only.
  (c) **Mobile passes.** Same scenarios at a phone viewport via a `demo-mobile` project rather than
  forked specs, opting in per scenario after one explicit compact-layout verification — mobile
  navigation differs (sheets, tab switcher), and desktop-only beats are skipped, not simulated. This
  is what replaces the hand-made mobile slides and animations.
  (d) **Route the four legacy scenarios through `resolveDemoProvider()`.** `hero-shot`,
  `07`, `08` and `09` predate the convention and hardcode `provider: "claude"` — functionally the
  same default, just not overridable.
  The end goal is that **every** screenshot on otto-code.me and every store slide is generated from
  this pipeline. _(Charter drained 2026-07-25.)_
- 🔵 **Site demos: two questions the pipeline never settled.** Should video show the bare web app, or
  add desktop-window framing in post? (Today the site does the framing in CSS, which is the
  cheaper-to-change answer.) And nothing in the pipeline flags a **stale brand asset** — both
  `og-image.png` and `hero-mockup.png` were found to be pre-fork Paseo screenshots by inspection, not
  by a run. A recurring check, or a drift guard, is unowned.

### i18n

**The pre-0.7.0 debt is paid** (2026-07-25, "Batch 5C" in
[docs/i18n.md](../docs/i18n.md#progress)). The five entries below that named seeded English, lagging
keys, English-only surfaces and dead keys are all closed; what remains is one review and two newly
named surfaces.

- ✅ **Seeded English is gone.** The Solution view (`workspace.solution.*`) and its host setting
  (`settings.host.code.solution` / `solutionHint`) carried the English source in all 7 non-English
  locales and are now really translated. `Solution` follows each locale's established .NET wording
  (Solución / Solution / ソリューション / Решение / 解决方案 / Solução / الحل) rather than staying
  English: it is a .NET concept with a localization users already know, and it is not one of the
  product nouns [docs/i18n.md](../docs/i18n.md#what-stays-in-english) keeps English.
- ✅ **History delete and worktree branch-cleanup were already translated** — those two entries were
  stale. Both landed translated in `beb4b833a`; only the `// i18n lag:` comments survived, and they
  have been removed so the next reader is not sent to fix something already done. **Read the tree,
  not the ledger, before starting a translate pass.**
- ✅ **The setup wizard, Refine and personality memory are migrated and translated.** ~200 new keys
  under `setupWizard.*`, `refine.*` and `contextManagement.memory.*` / `personalitySelector.*`,
  across all 8 locales. What deliberately stayed English is recorded in
  [docs/i18n.md](../docs/i18n.md#what-stays-in-english): the wizard's team prompts, functional cores
  and persona names, and Refine's seeded `instruction` — all model input rather than UI copy.
- ✅ **The destructive-dialog resolver family moved into i18n, whole.** `history/delete-dialogs.ts`
  plus `subagents/archive-subagent.ts`, `detach-subagent.ts` and `clear-completed-subagents.ts`.
  **The rationale is written down** in [docs/i18n.md § Dialog resolvers](../docs/i18n.md#dialog-resolvers):
  confirmation text is in scope, a destructive dialog is the worst place to make someone read a
  second language, and being a pure helper is not an exemption — pure helpers call `i18n.t(...)`
  directly (Batch 4Y). Provider display names stay literal; the neutral fallback is translated.
  Existing tests still assert English (`en` is the default) and `delete-dialogs.test.ts` gained a
  `changeLanguage("zh-CN")` case so the decision is guarded rather than remembered.
- ✅ **Dead keys from the edit-outside change are gone**, along with `suppressOutOfProjectWarning`
  and its setter in `editor-prefs-store.ts`. The sweep turned up more than dead keys: the two
  surviving `editor.outOfProject.badge*` strings were translations of a **superseded** English
  source — short badges like "Fuera del proyecto · {{project}}" against an English sentence that had
  grown to explain the consequence. Both were retranslated. **A key that exists in every locale can
  still be stale**; key parity does not catch a rewritten source string, and nothing in the guard
  suite does either.
- ⚪ **i18n: Agent personalities and Agent teams settings, including `ROLE_LABELS` / `ROLE_HINTS`.**
  `agent-personalities-section.tsx` (~2.4k lines) and `agent-teams-section.tsx` are English-only, and
  the shared role labels in `provider-selection/role-labels.ts` are consumed by five surfaces —
  three of which are now translated. Deliberately **left out of Batch 5C**: translating only the role
  pills would half-migrate the personalities editor, which is exactly the mixed-language state
  [docs/i18n.md](../docs/i18n.md#migration-order) forbids. Whole-surface pass or nothing.
- 🔵 **Review the `settings.general.mountedWorkspaceLimit.*` translations.** Added to `en.ts`
  2026-07-25 with the workspaces-kept-loaded setting (label, description, accessibilityLabel) and
  **picked up by the concurrent translation sweep the same day** — all 7 non-English locales carry
  real translations rather than seeded English, verified present, not reviewed by the author of the
  English. The description is the longest setting hint in the file and carries the load-bearing
  guidance ("set it to at least the number you actually switch between"), so it is worth a native
  read: a translation that softens that sentence loses the only part a user can act on.
- ⚪ **The guard cannot see a stale translation.** `resources.test.ts` catches missing keys, a
  fallback ratio and dropped interpolation placeholders — none of which fires when an English source
  string is rewritten and the seven translations keep answering the old question. That is how the
  `outOfProject.badge*` strings survived. A cheap fix exists: hash each English leaf and store the
  hash a translation was made against, so a changed source shows up as a lag list rather than as
  nothing at all.

---

## Build order

**Waves 0–4 are complete** (Wave 4 landed 2026-07-25 in `beb4b833a`, minus its delayed item 1). This
section is the judgement layer over the inventory above: what to do next, and why that rather than
the highest-scoring item.

**Next up is not a wave — it is a release.** See [Toward 0.7.0](#toward-070) below.

### Four ordering traps that outrank raw scoring

1. **Upstream merge → subagent convergence → provider adapters is a fixed order.** It gets _more_
   expensive the longer it waits, not less. It is the last item whose whole point is reducing
   divergence cost.
2. **Measurement precedes the fix.** The FPS item cannot start before resource reporting exists.
3. **Shared instrumentation is built once.** The Visualizer's context ring and the usage log's View B
   need the same exact-injected accounting.
4. **A prerequisite-only refactor is not independently justified.** `session-decomposition` is an
   impact-1 refactor that only makes sense as `mobile-daemon`'s prerequisite. If mobile-daemon is not
   the pick, do not do it.

### Wave 3 — memory, the performance floor, polish (in flight)

Cut 2026-07-25. The four items touch different code on purpose.

1. ✅ **personality-memory** — done 2026-07-25. Pulled forward from Wave 4 and expanded. Impact is
   compounding: every spawn used to start from zero, so the same corrections got re-taught forever.
   Shipped design: [docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons).
2. 🔄 **App-wide FPS degradation** — the spine, and the only item still open. The instrument came
   first as planned: `app/src/diagnostics/resource-report/`, `client/daemon-client-runtime-metrics.ts`,
   and a soak harness (`e2e/client-resource-soak.spec.ts` + `e2e/helpers/resource-monitor.ts`). The
   fix is being wrapped up. Trap 2 held — nothing was optimized before it was measured.
3. ✅ **System-injected delivery decision** — done. Mentions and notify-on-finish queue; the schedule
   case turned out to be a different question and is tracked above. Both steer-queue tails (reorder,
   interrupt receipt) shipped with it.
4. ✅ **References and sources index** — done. [docs/references.md](../docs/references.md). Explicitly
   groundwork for the Wave 5 candidate below.

**Dropped from this wave:** computer-use Phase 0, deferred by the product owner — the vision
capability is not the current focus.

#### personality-memory — the settled design (shipped)

These seven decisions were the spec, and all seven are built. The architecture they produced is
[docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons),
which also records what was considered and rejected. Kept here because the decisions themselves are
the reasoning, and the charter has drained to `archive/`.

- **Underneath, these are just stored memories.** No exotic representation.
- **Recording is fire-and-forget.** The agent states what it learned; the system handles storage,
  dedup and placement. No ids to track, no index to maintain. _If recording is harder than that,
  agents will not do it_ — this is the load-bearing constraint.
- **A "review lessons" tool** reads the accrued set back, forms updates, and asks the user clarifying
  questions in a session, rewriting the lesson from the answers. This is how lessons improve instead
  of accumulating as noise.
- **Context Management is the one place** to see and manage them, with a selector for _which
  personality you are viewing context for_. Entries are editable there.
- **Personality dialogs show accrual, not management** — enough that you would not delete one
  casually, but not full CRUD. A deliberate scope limit.
- **Deleting a personality offers delete _or transfer_** of its lessons to another personality.
  Required, not a follow-up — accrued knowledge must not be silently destroyed.
- **Injected context must be inspectable.** Memory is only trustworthy if you can see it.

### ✅ Wave 4 — provider parity and continuity — COMPLETE (2026-07-25)

**Dispatched without item 1**, which the product owner delayed; items 2, 3 and 4 ran in parallel and
all landed in `beb4b833a`. Two project folders drained and left (history-management,
total-token-accounting), which is rule 4 working as intended.

The wave's own header said "provider parity", and with item 1 delayed **that is not what shipped** —
what shipped was the Solution view, history delete, honest token totals and the context wiring. Worth
naming: the parity thesis is now a wave behind, not discharged.

**Standing note on item 1 — now measured, and the estimate was wrong about the driver.**
[findings/upstream/2026-07-25-paseo-merge-gap.md](../findings/upstream/2026-07-25-paseo-merge-gap.md)
replaces the guess with numbers. Merging `v0.2.2` today costs **369 conflicted files / 1,365 conflict
hunks / 30,054 conflicted lines**, against **68 files / 125 hunks** for the last completed merge
(2026-07-12). Three corrections to what this section used to say:

- **The cost curve steps on upstream minors; it does not slope with our divergence.** Otto's 419
  commits since the merge-base add **+17 hunks** against a frozen `v0.1.107` over twelve days. The
  same twelve days took the day-of cost from 60 to 1,365 hunks — almost entirely from one upstream
  release, `v0.2.0` (237 commits), cut 2026-07-24. So "every wave it waits, it buys less" is true but
  mis-attributed: **1,250 of today's 1,365 hunks were already sunk the day before the delay decision
  was taken.** The delay's own share so far is **+115 hunks, +9%**. The question that matters is
  whether to merge before upstream cuts `v0.3.0`, not how many days pass.
- **The rebrand shortcut does not exist.** **Zero of 1,365 hunks** are resolvable by
  `scripts/rebrand-upstream.pl` alone — 346 carry upstream naming, none carry _only_ naming.
  Pre-applying the rules to upstream's side makes it worse (409 files / 1,772 hunks). Budget for
  judgement on all 369 files.
- **The subagent convergence is free and should ride with the merge, not follow it.** Upstream's
  daemon-side ingestion is 47 files with **zero conflicts**; the client half Otto keeps is **14
  hunks**. Sequencing it as a separate phase behind the merge buys nothing.

Estimate for the merge itself: **≈23–35 agent-sessions**, extrapolated from the 2026-07-12
calibration point and explicitly not a measurement. It excludes two design collisions the merge
surfaces — upstream independently shipped **a file editor** (`app/src/file-pane/editor/`, 9 files) and
**Changes-as-a-tab plus commit history**, against Otto's own 56-file `app/src/editor/`. That is the
`v0.2.0` forge cautionary tale repeating twice, and the cadence rule meant to catch it early ("read
every minor release's changelog even when you skip the merge") did not run.

Setup notes in this section were stale and are corrected: the `upstream` remote **does** exist, and
upstream has now tagged `v0.2.2` as well. Merge at **`v0.2.2`** — both patches carry Claude 5 fixes
Otto wants, and the premium over `v0.2.0` is +2 files / +5 hunks.

1. ⏸️ **Upstream merge → subagent convergence → provider adapters** (trap 1, non-negotiable
   order) — **delayed by the product owner, 2026-07-25.** Not being taken this wave. The delay stands;
   the numbers above only sharpen what reopening it costs.
2. **Shared context instrumentation** — the Visualizer readout and the usage log (trap 3). **Trap 3
   is largely already discharged**; see the correction below.
3. ✅ **total-token-accounting** and ✅ **history-management** — trust and tidiness. Both shipped
   2026-07-25; history-management once its decision gate was answered (see below). Accounting rules
   folded into [docs/subagent-accounting.md § Chat totals](../docs/subagent-accounting.md#chat-totals-one-honest-number-per-chat)
   and the spend/occupancy/cost vocabulary into [docs/glossary.md](../docs/glossary.md).
4. ✅ **solution-view Phase 1** — done 2026-07-25, together with the Phase 0 groundwork it needed.
   The read-only Solution lens, its sidecar and its switch; architecture in
   [docs/solution-view.md](../docs/solution-view.md), remaining phases in
   [Open work](#editor--code-intelligence). Impact was provider-shaped in the same way the adapters
   are: a 5 for .NET developers, a 1 for everyone else. Phase 2 (general file mutations) is not .NET
   work and enables mutation paths beyond it.
   `claude-extensions` belongs to **Wave 5**, not here — product owner's call, 2026-07-25. It is
   deliberately Claude-only, which would have blurred the meaning of a wave whose whole theme is
   provider parity, and it would have competed for the same hours as item 1 without item 1's compounding
   cost. See its treatment under Wave 5 below.

#### Correction: the context instrumentation is mostly built (2026-07-25)

The [visualizer-node-richness](visualizer-node-richness/visualizer-node-richness.md) charter says the
ring and bar are blank because the adapter omits `contextBreakdown`, over a fixed 5-way breakdown
(`systemPrompt · userMessages · toolResults · reasoning · subagentResults`). **Both halves of that are
now wrong**, and the charter needs correcting:

- **The accounting exists.** `agent.context.get_usage` (`COMPAT(agentContextUsage)`, v0.3.4) returns
  `{ categories: [{ name, tokens, isDeferred? }], totalTokens, maxTokens }`. Categories are
  **provider-supplied display labels**, an open-ended list — not a fixed enum. Three providers report
  it (Claude, openai-compat, Pi); Codex, Copilot and OpenCode do not. Two surfaces already render it:
  `context-window-meter.tsx` and `context-management/summary.tsx`
- **The display changed.** `contextDisplay` is `'ring' | 'bar'` (default `ring`) and draws **one**
  readout, not both — the page used to show the same number twice. Sub-agent nodes never had a ring

So trap 3's "build the hard part once" is **already discharged**. What remains is narrower than the
charter implies: wire `breakdown` through `use-visualizer-event-adapter.ts` (which never sends it),
give the usage log the same numbers rather than a second path, and extend provider coverage.

#### Decided, then shipped: what delete does to provider data (2026-07-25)

history-management's `[PROPOSED]` gate was answered by the product owner. **Deleting a chat removes
Otto's record only; the provider's own transcript is left in place.** An opt-in switch to also delete
provider data was considered and **rejected** — _"that seems dangerous grounds."_ It was not built, and
no disabled placeholder for it exists.

Two consequences rode with that decision: the UI is **honest that the provider still has its
transcript** (leaving data recoverable is worthless if nobody knows it is there), and **bulk clear
carries the same rule** rather than becoming a back door in aggregate. The CLI's `agent delete` carries
the same semantics — a CLI that deletes more than the app would be the worst kind of surprise.

**Built the same day.** Per-row delete (long-press an archived row → destructive confirm), bulk
**Clear archived** with an All / Active / Archived filter, the `history.agents.clear_archived` sweep
(`dryRun` first, defaulting to true), the `features.historyDelete` gate, the react-query reconcile that
made deleted rows actually disappear, `--archived` / `--include-archived` on the CLI, and all four
retention bugs. Durable semantics — including what was rejected and why — live in
[docs/chat-lifecycle.md § Delete](../docs/chat-lifecycle.md#delete) and
[docs/activity-stats.md § Retention](../docs/activity-stats.md#retention). Charter drained to
`archive/projects/history-management/`; the remaining tails are in
[Open work → Git, changes & history](#git-changes--comments).

One decision the build added, worth not re-litigating: the sweep has **no `scope: "all"`**. Delete is
reachable only for a chat that was archived first, and that is enforced twice — the app offers it only
on an archived row, _and_ `selectArchivedForDeletion` refuses any record without an `archivedAt`
whatever the cutoff. The dangerous branch was never built, so it cannot be reached by accident.

#### Readiness, item by item (checked 2026-07-25)

| Item                              | Ready?                      | What actually gates it                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. upstream merge → convergence   | ✅ **unblocked, and sized** | The charter's "blocked on `v0.2.0`, currently untagged" blocker is gone — upstream has tagged `v0.2.0`, `v0.2.1` and `v0.2.2`, the `upstream` remote exists, and the charter now says so. **Measured 2026-07-25:** 369 conflicted files / 1,365 hunks at `v0.2.2`; 0 of them naming-only; convergence itself is conflict-free. ≈23–35 sessions, excluding the file-editor collision. [findings](../findings/upstream/2026-07-25-paseo-merge-gap.md) |
| 1b. provider adapters             | ✅ ready, cheap             | The contract is two events plus one optional method, and nothing in the protocol, daemon projection or client says "claude". Per-provider sub-agent accounting rides the same stream. The risk is all in convergence, not here                                                                                                                                                                                                                      |
| 2. shared context instrumentation | 🟡 half done                | Visualizer ring ✅ 2026-07-25 — unified onto the provider's own accounting (`AgentUsage.contextCategories`, open-ended labels), so the ring and the context meter read one source. **Trap 3 was wrong:** View B does _not_ share this accounting — it needs Otto's own prompt-assembly instrumentation, which no provider can report. See the View B entry                                                                                          |
| 3a. total-token-accounting        | ✅ **shipped**              | Built 2026-07-25 on the 2026-07-17 audit. The audit's four findings held, plus a fifth it missed: Pi and OpenCode report a running SESSION total, so the ledger re-booked it every turn. Charter drained                                                                                                                                                                                                                                            |
| 3b. history-management            | ✅ **shipped**              | The `[PROPOSED]` set was answered 2026-07-25 and built the same day (Phases 0, 1 and 3; Phase 2 was deleted outright by the answer, not deferred). Open tail: multi-select, auto-retention, i18n. Charter drained                                                                                                                                                                                                                                   |
| 4. solution-view Phase 1          | ✅ **done**                 | Built 2026-07-25. The spike's 193 KB estimate landed at 257 KB once `Microsoft.Build.Locator` was in; two corrections came out of finishing it — `RollForward=LatestMajor` is required (a `net8.0` payload will not start on a .NET 9/10-only host), and Buildalyzer was rejected on measurement                                                                                                                                                    |

**The shape this implies.** Item 1 is the wave — it is the only item whose cost rises with delay, and
its stated blocker just cleared. Items 3a and 3b are **done**; item 2 is half done. What remains of
the wave is item 1, the usage log's View B, and item 4, all spawn-ready today.

### Toward 0.7.0

**Waves 2, 3 and 4 are unreleased against `v0.6.7`** — a genuinely larger product cut than a patch:
Refine, the full LSP set, the steer queue, personality memory, the Solution view, history delete,
honest token totals, AsciiDoc, mermaid, resource reporting, general file mutations. Note the release playbook's standing rule
— **releases are always patch unless the product owner says "minor"**
([docs/release.md](../docs/release.md)). This section is the argument that this one is a minor; the
call is not ours.

**All four pre-cut items are now done** (2026-07-25). What follows is the record of what each one
turned out to be, because two of them did not go the way the plan expected.

**1. ✅ The FPS work — and the headline conclusion was withdrawn.** The plan said the cause was
confirmed (mounted workspace trees never released, ~35% of the frame rate) and only a product
decision blocked the fix. **Both halves were wrong**, and finding that out is the most valuable
result in the release:

- **Eviction already worked.** The earlier soak seeded exactly three workspaces and measured 1 → 3 —
  at or below the existing cap — so the eviction path could not have run. At three workspaces,
  "retained because nothing reclaims it" and "retained because the cap was never reached" produce an
  identical series. Re-measured above the cap, mounted trees sit flat while six workspaces are
  visited and the released queries reappear as `query.unobserved`, the signature of a React unmount.
- **The −35% was an artifact.** It came from a decile statistic that is one sample at twelve cycles.
  The same configuration produced both verdicts on consecutive runs — including "degraded" at a cap
  of 1, where retention is provably constant. **Two runs per cap value is what exposed it.**

So **no confirmed cause remains for the reported symptom**; the live candidate is render cost per
inbound daemon message. What did ship: the cap became the user setting `mountedWorkspaceLimit`
(device-local, default 5, driven by real usage — 8 workspaces with ~4 in rotation made the old cap of
3 sit one short of the working set), the navigation path stopped re-asking for state the client
already holds, and the stream buffers gained a release path.

**2. ✅ i18n — paid, and one decision was taken rather than dodged.** The seeded-English keys, the
English-only surfaces and the lagging keys are cleared, and `docs/i18n.md` now records what
deliberately **stays** in English. The embedded decision — whether the destructive-dialog resolver
family moves into i18n — was settled **whole** rather than half-moved, with the rationale written
down. A remaining tail (personalities/teams settings, `ROLE_LABELS` / `ROLE_HINTS`) is scoped as
whole-surface-or-nothing, which is the migration order the doc requires.

**3. ✅ The six owed fold-ins.** All paid, five folders drained; see
[Owed fold-ins](#owed-fold-ins) for what landed where and why e2e-qa-coverage keeps its folder.
`docs/` gained three pages and three sections. The tree is reconciled going into the cut, which is
what stops the next assessment starting with "five charters disagree with the code".

**4. ✅ The integrated pass.** Ran against the combined feature set and corrected at least one
inventory entry that had gone stale — see the Editor and Performance sections for what it turned up,
including the honest note that the performance-monitoring off switch does not uninstall its timer
patch.

**The pattern worth keeping from this release:** two of the four items overturned the plan that
spawned them. Both did it by re-measuring rather than by arguing, and both wrote down the harness
error that produced the wrong answer. `findings/` earning its own home during this cycle is not a
coincidence.

**Explicitly not before 0.7.0:** the Wave 5 bets below, and the upstream merge chain. The merge is
the one thing whose cost keeps rising — but starting it days before a release cut is how a release
slips.

### Wave 5 candidate — agentic architectures for coding tasks

Added 2026-07-25. **The thesis:** once the IDE-grade platform is solid — coding tasks executed,
shown, and reviewable by a human — the orchestration system is unlocked, and the payoff is _reusable
coding pattern templates_: structures for building software features that replace the growth pains of
bad prompting and ad-hoc AI use. It is the reason the platform work came first, not a separate
ambition.

This is a wave-scale architecture consolidation, not a feature. It builds on
[agent-orchestration](agent-orchestration/agent-orchestration.md) (the control layer) and the built
graph engine and designer. Its groundwork is
[docs/references.md](../docs/references.md) — specifically
[§12, the ordered reading list](../docs/references.md#12-reading-list-for-the-agentic-coding-templates-initiative),
which exists for exactly this.

**Formalized 2026-07-25 as the [graph-templates](graph-templates/graph-templates.md) charter** —
the measurement layer (per-node accounting, capability scoring, multi-mechanism grading, the T2
golden-graph harness), the starter-template library with its use-case catalog
([use-cases.md](graph-templates/use-cases.md)), and AI graph authoring as the convergence path.
Engine-side decisions live in `archdocs/pages/12-orchestration-data-model.adoc` §"Decided, not
built".

**Against Wave 5's "pick one" rule:** this and agent-orchestration are not independent bets.
Agent-orchestration is the substrate this stands on, so if this is the direction, that is the pick.

### Wave 5 — the big bet

Pick **one** of agent-orchestration or (session-decomposition → mobile-daemon). Both are
quarter-scale and both are strategically defensible; running them concurrently in one shared working
tree is not.

**Alongside the big bet: [claude-extensions](claude-extensions/claude-extensions.md).** Added
2026-07-25 at the product owner's direction. Full plugin, marketplace, skill and MCP management in
the Claude provider settings panel — the most-asked-for capability Otto does not have, and today the
one thing you still have to leave the app and SSH into the host to do.

It does **not** consume the pick-one slot. That rule exists because two quarter-scale bets cannot
share one working tree; this is roughly seven to nine sessions across five independently shippable
phases, and it touches disjoint code — the Claude provider adapter and one settings sheet, neither of
which the orchestration or mobile-daemon work goes near.

**The scope is enablement, not CRUD.** Install/remove is the floor. The reason this earns a wave slot
is the context budget: `claude plugin details` reports each plugin's always-on token cost, nothing in
Claude Code totals it across everything installed, and users accumulate plugins for months without
knowing what they pay before typing a word. Otto can total it, rank by it, and put it next to the
Disable button — the same move [docs/token-economy.md](../docs/token-economy.md) makes everywhere
else. That ships in Phase 1, not later. Behind it: installed-vs-actually-loaded (Otto is the only
place that knows both), MCP failures reported as cause-and-next-action rather than a red dot, and a
plugin authoring loop built on `plugin eval --json`, which scores against a no-plugin baseline.

Three things to settle before the phase that needs them, not during it: whether v1 shows user-scope
only (the provider settings sheet is host-level, but plugins and MCP servers can be project-scoped);
how the token-cost presentation stays unified with context-management's open "skills/MCP toggles"
tail — two surfaces will describe the same context consumption in different units if nobody decides;
and the default cost ceiling for `plugin eval`, which spends real money per run.

### ⚠️ Divergence from upstream Paseo

The fork has always aimed to keep merge capability with upstream
([docs/upstream-merges.md](../docs/upstream-merges.md)), **and we are nearing the divergence point.**
The waves above are what push past it — personality memory, an agentic orchestration layer and a
per-personality context model have no upstream counterpart to merge against.

Two consequences worth acting on rather than discovering later:

- The trap-1 ordering gets **more** expensive the longer it waits.
- **Watch for anything that silently forfeits merge capability.** A concrete instance: a literal NUL
  byte in a string makes git treat the whole file as **binary** — no textual diff, no 3-way merge.
  Use the `"\0"` escape instead. Two files have hit this.

## Deferred indefinitely

Not dead, but not scheduled, and not to be picked up opportunistically:

multiplayer · Visualizer Arena mode · computer-use beyond Phase 0 · bug-reporting's **host-owner
sink** (the daemon-files-a-GitHub-issue half — a different user than ours; the hosted-intake half
shipped) · git-hosting GitLab (until a GitLab user exists) · LSP Phase 4 / Angular · workspace-level
reconciliation of pre-guard duplicate base workspaces (no standing duplicates observed).

**Closed — do not re-open:** duplicate base workspaces. The investigation closed with the verdict
_prevent and steer to a worktree_, which is already the shipped policy; its three execution gaps were
fixed and the behaviour is documented in
[docs/workspace-lifecycle.md](../docs/workspace-lifecycle.md). Listed here only so it is not
rediscovered as new work. Folder: `archive/projects/duplicate-base-workspaces/`.

## Owed fold-ins

Shipped work whose durable facts have **not yet** reached `docs/`. Each is a debt against rule 4 —
until it is paid, the project folder cannot leave.

**None outstanding.** The one debt found 2026-07-28 was paid the same day (below the table). The six
debts standing at the start of the 0.7.0 run were paid on 2026-07-25,
and **file-rendering was drained the same day** — mermaid, AsciiDoc and relative image resolution all
folded into [docs/markdown-rendering.md](../docs/markdown-rendering.md), its unbuilt tail moved to
[File rendering](#file-rendering) above, its two code citations (`task-lists.ts`,
`file-pane-render-mode.ts`) and its `docs/references.md` row repointed:

| Was owed by              | Paid into                                                                                                     | Folder            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| context-management       | [docs/context-management.md](../docs/context-management.md) — new page                                        | drained           |
| refine                   | [docs/refine.md](../docs/refine.md) — new page                                                                | drained           |
| site-demos               | [docs/site-demos.md](../docs/site-demos.md) — new page                                                        | drained           |
| workflow-decomposition   | [docs/subagent-accounting.md](../docs/subagent-accounting.md#workflow-decomposition-a-synthetic-event-source) | drained           |
| visualizer-node-richness | [docs/visualizer.md](../docs/visualizer.md) — "Discovery cards", beside the already-folded "Context ring"     | drained           |
| e2e-qa-coverage          | [docs/testing.md § App end-to-end tiers](../docs/testing.md#app-end-to-end-tiers-playwright)                  | **stays** — below |

**One debt found and paid 2026-07-28.** `projects/subagents-cleanup/` was retired 2026-07-14 on the
stated claim that its rules were folded into `docs/agent-lifecycle.md`. That page never existed, so
for two weeks no `docs/` page carried its load-bearing gotcha. Now paid into
[docs/chat-lifecycle.md § Row actions, names, and cost](../docs/chat-lifecycle.md#row-actions-names-and-cost):
observed-subagent ids (`parent::sub::key`, an ephemeral registry projection with no `ManagedAgent`)
must be special-cased at **every** lifecycle verb, fetch and stop and archive. Archive was the one
originally missed, which broke the terminal-row Archive and "Clear all" for observed rows. The
native-idle-is-not-terminal rule and the stop-pin went to the same section.

**A dangling pointer was found in the same pass.** `docs/chat-lifecycle.md` linked to
`projects/total-token-accounting/`, drained during Wave 4, and now points at
[docs/subagent-accounting.md § Chat totals](../docs/subagent-accounting.md#chat-totals-one-honest-number-per-chat)
instead. This is exactly the failure the note below the table warns about; a sweep of every
`../projects/<name>/` link in `docs/` found no others.

**Why e2e-qa-coverage keeps its folder even though its debt is paid.** Its
[coverage-matrix.md](e2e-qa-coverage/coverage-matrix.md) is not a plan — it is **live tooling**.
`scripts/e2e-coverage-check.mjs` reads it to fail on stale rows and unmapped specs, and
`packages/app/e2e/reporters/qa-reporter.ts` reads its section headings to bucket every test in a run
report. Archiving it would break `npm run e2e:coverage` and produce an all-"Unclassified" report.
The project also has a genuine unshipped remainder (the Phase 3.5 iron-out and the ❌ rows), so it
stays a Partial charter rather than a drained one. Rule 4 is about status documents rotting in this
tree, not about deleting a file the build depends on.

**A note for the next pass, since this one hit it.** A drained folder is only actually removable once
nothing points at it. Five of the six were cited from **code comments** (`refine-generator.ts`,
`context-management/types.ts`, `workflow-transcript-*.ts`, the visualizer adapter, eight i18n
resource files) and from `packages/app/demo/README.md`. Those citations were repointed at the new
`docs/` pages as part of the drain. Grep for `projects/<name>` across `packages/`, `docs/`,
`scripts/` and `archdocs/` before removing a folder — a dangling pointer into `archive/` is worse
than the charter was.
