# CLAUDE.md

## Why this fork exists

This repo (otto-code) is a fork with one mission: extend Otto into a **fully featured agentic coding assistant** — an IDE-grade environment with a rich feature set, familiar enough that you never feel constrained, that brings **frontier-model tooling to every provider equally, cloud and local alike**. The tooling a frontier harness gives its own model — browser-verified previews, artifacts, subagent visibility, context compaction, permission modes, MCP — should be just as available to a local model served from LM Studio as to a hosted frontier API. A capability isn't done when one provider has it; it's done when they all do.

The founding proof was the **Preview subsystem** — a rebuild of the Claude Code app's built-in `Claude_Preview` MCP server, shipped for all providers: agents start dev servers from a launch config, then verify browser-rendered changes (accessibility snapshots, DOM inspection, console/network capture, click/fill, viewport resize, screenshots), showing proof instead of asking the user to check manually. Read [docs/preview.md](docs/preview.md) before working on anything preview-related — it carries the design principles that must survive future changes (token economy, guardrail-bearing tool descriptions, daemon-enforced tab binding). The dev-server half lives in `packages/server/src/server/preview/`; the verification half is the daemon's browser-tools subsystem (`packages/server/src/server/browser-tools/`) executing against the Otto browser pane. Extend these; don't build a parallel browser stack.

The same leveling-up pattern has since shipped artifacts, the natively-tooled OpenAI-compatible provider (daemon-owned tool loop, MCP client, compaction, rewind), observed subagents for Claude, a provider-neutral git-hosting layer (GitHub + Bitbucket Cloud, see [docs/git-providers.md](docs/git-providers.md)), and agent personalities (named per-host templates with roles, spawnable by orchestrating agents, see [docs/agent-personalities.md](docs/agent-personalities.md)) — with the remaining per-provider gaps tracked as initiatives in `projects/`. When adding a capability, design it provider-agnostic first and treat single-provider support as the proof, not the finish line.

## Repository map

`test-documents/` (repo root) holds hand-authored, self-contained fixtures for the file viewer — one per supported format, covering syntax highlighting and rendered previews. See [test-documents/README.md](test-documents/README.md). It is excluded from oxlint and oxfmt: the varied formatting is the point.

## Documentation

Four trees. Know which one you are in before you write anything down.

| Tree                                  | What it holds                                                                                | Tense               |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------- |
| **[`docs/`](docs/README.md)**         | The official software documentation — how Otto works. **This is the spec we build against.** | Present             |
| **[`projects/`](projects/README.md)** | Charters for unbuilt work, and **the single open-work ledger**                               | Future              |
| [`archdocs/`](archdocs/README.md)     | The system-level architecture record — AsciiDoc + Mermaid, one level above `docs/`           | Present, wide-angle |
| **This file**                         | Working rules for agents in this repo                                                        | Imperative          |

**The indexes are [`docs/README.md`](docs/README.md) and [`projects/README.md`](projects/README.md).
This file does not duplicate them** — it used to carry both tables, and two copies of an index means
one of them is wrong. At the start of non-trivial work, open the relevant index and skim what
matters.

**"The docs", "check the docs", or "check the X docs" always mean `docs/` — not the web.** Look there
before fetching anything online; it captures gotchas and conventions you cannot derive from the code
or from external sources.

`public-docs/` is the user-facing manual published to otto-code.me. Different audience, different
contract — it documents what Otto does, not how it is built. Do not put engineering notes there.

### Read these before touching the matching area

Non-negotiable. Each one exists because someone got it wrong first.

| Before you touch…                                                                     | Read                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything preview- or browser-tool-related                                             | [docs/preview.md](docs/preview.md) — token economy, guardrail-bearing tool descriptions, daemon-enforced tab binding, **per-workspace scope (chats trample each other), and always prefer the running server** |
| App routes, startup routing, remembered-workspace restore, active-workspace selection | [docs/expo-router.md](docs/expo-router.md)                                                                                                                                                                     |
| Styling                                                                               | [docs/unistyles.md](docs/unistyles.md) — `useUnistyles()` is forbidden; [docs/hover.md](docs/hover.md); [docs/design.md](docs/design.md)                                                                       |
| WebSocket schemas or validation                                                       | [docs/protocol-validation.md](docs/protocol-validation.md) and [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                                                                                              |
| Go-to-definition, hover, references, rename, diagnostics                              | [docs/code-intelligence.md](docs/code-intelligence.md)                                                                                                                                                         |
| Anything that rides in a model request                                                | [docs/token-economy.md](docs/token-economy.md) — the five structural multipliers                                                                                                                               |
| Fixed context weight, the context graph, or the Context Management tab                | [docs/context-management.md](docs/context-management.md) — hard vs soft edges, % of window as the severity unit                                                                                                |
| Refine, or widening what it may rewrite                                               | [docs/refine.md](docs/refine.md) — **prose only**: no parser, no symbol table, `refine-scope.ts` is the one gate                                                                                               |
| App Playwright E2E, or adding a spec                                                  | [docs/testing.md](docs/testing.md) — the three tiers, and the coverage matrix a spec must be added to in the same change                                                                                       |
| Marketing-site or store captures                                                      | [docs/site-demos.md](docs/site-demos.md) — the whole-frame rule, the gotchas ledger, and the resolution/zoom trap                                                                                              |
| Terminology in UI copy                                                                | [docs/glossary.md](docs/glossary.md) — the UI label wins, no synonyms                                                                                                                                          |
| Website copy, `public-docs/`, release notes, marketing drafts                         | [docs/writing-style.md](docs/writing-style.md) — **never use em-dashes in prose**, the five replacements, first-person voice                                                                                   |
| A new agent provider                                                                  | [docs/providers.md](docs/providers.md)                                                                                                                                                                         |

### Where new knowledge goes

- **Code-level facts** → inline comments next to the code.
- **System, process and gotcha-level facts** → a page in `docs/`, **and a row in
  [`docs/README.md`](docs/README.md)**. An unlisted page is an invisible page.
- **Point-in-time plans** (a feature build-out, a charter, a refactor plan) → `projects/<name>/`,
  one folder per initiative, **and a row in [`projects/README.md`](projects/README.md)**.
- **Status — what is done and what is not** → [`projects/README.md`](projects/README.md) only. It is
  the single source of truth. Do not start a second registry, a findings file, or a dated batch
  document; that is how four competing ledgers happened last time.
- **An external source that shaped a decision** → [`docs/references.md`](docs/references.md),
  including sources you evaluated and rejected.

### When a project ships

Fold its durable facts into the relevant `docs/` page, move any remaining tail into
[`projects/README.md`](projects/README.md), then **remove the folder**. A shipped project left in
`projects/` is the most common way that tree rots.

Removed folders move to `archive/` at the repo root, which is **gitignored** — out of the repo, still
on disk. Nothing there is active work; do not pick items up from it. If something is genuinely dead,
delete it rather than archiving it.

## Quick start

Scripts live in the root `package.json`. The two whose invocation is not guessable:

```bash
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
```

**Dev and the installed app are fully isolated, and are meant to run at the same time.** Every repo dev command resolves through `scripts/dev-home.{sh,ps1}` to the dev daemon on port `6788` and the checkout-local `OTTO_HOME` at `packages/desktop/.dev/otto-home` — including `npm run cli -- ...`. The installed desktop app and its daemon keep `~/.otto` on port `6868` and are never touched. Never hardcode `6868` into a dev script or a launch config; that is the installed app's port, and landing on it either crash-loops the dev daemon or silently points dev clients at production agents.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Otto daemon on port 6868 without permission** — that is the installed app's daemon over `~/.otto`, it manages all running agents, and if you're an agent, restarting it kills your own process. The dev daemon on `6788` is the one you may restart freely.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **Before changing app routes, startup routing, remembered workspace restore, or active workspace selection, read [docs/expo-router.md](docs/expo-router.md).**
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses oxfmt for formatting (oxlint for linting). Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Two separate contracts:
  - **Protocol contract (always):** schema changes must not break parsing in either direction. An old client must still parse messages from a new daemon; a new daemon must still parse messages from an old client.
    - New fields: `.optional()` with a sensible default.
    - Wire schemas are pure structural declarations. Do not add `.transform()`, `.catch()`, or `.preprocess()` to WebSocket message schemas; put normalization in an explicit post-validation pass.
    - Plain `z.union()` is forbidden when every branch has a shared literal tag. Use `z.discriminatedUnion()` unless generated-code regression tests prove that specific shape is miscompiled.
    - `.default()` is acceptable on primitive leaves only. Never put defaults on item schemas for large arrays or big inbound containers.
    - Never flip optional → required, remove fields, or narrow types (`string` → `enum`, `nullable` → non-null).
    - Removed fields stay accepted (we stop sending them, not stop reading them).
    - Test with: "does a 6-month-old client still parse this?" and "does a 6-month-old daemon still send something this client accepts?"
  - **Feature contract (per-feature):** a new feature may require a new daemon capability. The client detects whether the capability is present and either runs the feature or shows "Update the host to use this." That's it.
    - **No fallback paths.** Don't write a degraded version of a new feature that runs on old daemons. Don't fan out across legacy RPCs to simulate a missing capability. The user upgrades or doesn't get the feature.
    - **No defensive branches scattered through the feature.** Capability detection happens in one place; downstream code reads a clean shape.
    - **Capability flags live in `server_info.features.*`** with a single `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` comment marking the cleanup site.
    - Existing functionality keeps working across versions — that's the protocol contract doing its job. New-feature degradation is not the goal.
    - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

- **All back-compat shims are tagged and dated for cleanup.** Every shim that exists for old-client/old-daemon support carries a `COMPAT(name)` comment with the version it was added in and a target removal date (typically 6 months out). One grep — `rg "COMPAT\("` — should produce the full list of cleanup work. Don't bury back-compat in untagged `??`-fallbacks or optional-chain tunnels — that's how it stops being deletable.

## Platform gating

See [packages/app/CLAUDE.md](packages/app/CLAUDE.md). It loads automatically when you work under `packages/app`, and covers the four gates (`isWeb`, `isNative`, `getIsElectron()`, `useIsCompactFormFactor()`), Metro `.web`/`.native`/`.electron` file resolution, and why hover does not fire on native.

## Debugging

Find the complete daemon logs and traces in the $OTTO_HOME/daemon.log
