# CLAUDE.md

Otto is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, GitHub Copilot, OpenCode, and Pi.

## Why this fork exists

This repo (otto-code) is a fork with one mission: extend Otto into a **fully featured agentic coding assistant** — an IDE-grade environment with a rich feature set, familiar enough that you never feel constrained, that brings **frontier-model tooling to every provider equally, cloud and local alike**. The tooling a frontier harness gives its own model — browser-verified previews, artifacts, subagent visibility, context compaction, permission modes, MCP — should be just as available to a local model served from LM Studio as to a hosted frontier API. A capability isn't done when one provider has it; it's done when they all do.

The founding proof was the **Preview subsystem** — a rebuild of the Claude Code app's built-in `Claude_Preview` MCP server, shipped for all providers: agents start dev servers from a launch config, then verify browser-rendered changes (accessibility snapshots, DOM inspection, console/network capture, click/fill, viewport resize, screenshots), showing proof instead of asking the user to check manually. Read [docs/preview.md](docs/preview.md) before working on anything preview-related — it carries the design principles that must survive future changes (token economy, guardrail-bearing tool descriptions, daemon-enforced tab binding). The dev-server half lives in `packages/server/src/server/preview/`; the verification half is the daemon's browser-tools subsystem (`packages/server/src/server/browser-tools/`) executing against the Otto browser pane. Extend these; don't build a parallel browser stack.

The same leveling-up pattern has since shipped artifacts, the natively-tooled OpenAI-compatible provider (daemon-owned tool loop, MCP client, compaction, rewind), and observed subagents for Claude — with the remaining per-provider gaps tracked as initiatives in `projects/`. When adding a capability, design it provider-agnostic first and treat single-provider support as the proof, not the finish line.

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Mobile + web client (Expo)
- `packages/cli` — Docker-style CLI (`otto run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access
- `packages/desktop` — Electron desktop wrapper
- `packages/website` — Marketing site (otto-code.me)

## Docs

`docs/` is the source of truth for system-level and process-level knowledge. **"The docs", "check the docs", or "check the X docs" always mean this directory — not the web.** Look here before fetching anything online; the docs capture gotchas and conventions you cannot derive from the code or external sources.

At the start of non-trivial work, list `docs/` and skim anything relevant to the task. When you learn something meta worth preserving — a gotcha, a convention, a workflow, a piece of system context that will outlive the current task — update an existing doc or propose a new one. Code-level facts belong in inline comments next to the code; system, process, and gotcha-level facts belong in `docs/`.

`docs/` is architectural documentation only — durable, evergreen facts about how Otto works. Point-in-time plans for a specific piece of work (a feature build-out, a charter for something not yet built, a refactor plan) belong in **`projects/<name>/`** instead, not `docs/`. A project folder can hold as many fine-grained `.md` files as the work needs (task breakdowns, sub-plans) — see `projects/observed-subagents/` for the shape. Once a project ships, fold any facts worth keeping into the relevant `docs/` file and delete the project folder (the artifacts, preview-mcp, and fork-review projects all ended this way).

| Doc                                                                              | What's in it                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/product.md](docs/product.md)                                               | What Otto is, who it's for, where it's going                                                                                                                                           |
| [docs/architecture.md](docs/architecture.md)                                     | System design, package layering, WebSocket protocol, agent lifecycle, data flow                                                                                                        |
| [docs/preview.md](docs/preview.md)                                               | The finished Preview feature — design principles (token economy, guardrail descriptions, daemon enforcement), settings, managing servers, preview vs. normal browser tabs, launch.json |
| [docs/upstream-merges.md](docs/upstream-merges.md)                               | Ingesting upstream Paseo changes — remote setup, rebrand tooling, merge playbook                                                                                                       |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)                               | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                                                                                          |
| [docs/data-model.md](docs/data-model.md)                                         | File-based JSON persistence, Zod schemas, atomic writes, no migrations                                                                                                                 |
| [docs/glossary.md](docs/glossary.md)                                             | Authoritative terminology — UI label wins, no synonyms                                                                                                                                 |
| [docs/coding-standards.md](docs/coding-standards.md)                             | Type hygiene, error handling, state design, React patterns, file organization                                                                                                          |
| [docs/design.md](docs/design.md)                                                 | Theme tokens — colors, fonts, spacing, radii, icons                                                                                                                                    |
| [docs/hover.md](docs/hover.md)                                                   | Hover — the canonical pattern (plain View + onPointerEnter/Leave, separate inner Pressable) and the three ways agents break it                                                         |
| [docs/unistyles.md](docs/unistyles.md)                                           | Unistyles gotchas — `useUnistyles()` is forbidden, alternatives in order                                                                                                               |
| [docs/floating-panels.md](docs/floating-panels.md)                               | Anchored popovers — Portal/Modal escape for Android, lifecycle gates, keyboard-shared-value, status-bar offset, the flash                                                              |
| [docs/expo-router.md](docs/expo-router.md)                                       | Expo Router route ownership, startup restore, and native blank-screen gotchas                                                                                                          |
| [docs/forms.md](docs/forms.md)                                                   | Form architecture — non-React form model, form kit, load-state gating; the schedule form is the golden example                                                                         |
| [docs/protocol-validation.md](docs/protocol-validation.md)                       | zod-aot generated inbound WebSocket validation, patched compiler regressions, schema-purity rules                                                                                      |
| [docs/file-icons.md](docs/file-icons.md)                                         | Material icon theme integration for the file explorer                                                                                                                                  |
| [docs/ui-icons.md](docs/ui-icons.md)                                             | General UI icons — Material Symbols vendoring, codegen script, how to add/change an icon                                                                                               |
| [docs/providers.md](docs/providers.md)                                           | Adding a new agent provider end-to-end                                                                                                                                                 |
| [docs/custom-providers.md](docs/custom-providers.md)                             | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                                                                                      |
| [docs/service-proxy.md](docs/service-proxy.md)                                   | Service proxy: exposing workspace scripts at public URLs, DNS setup, reverse proxy config                                                                                              |
| [docs/development.md](docs/development.md)                                       | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP                                                                                                             |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                               | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                                                                                   |
| [docs/terminal-performance.md](docs/terminal-performance.md)                     | Terminal latency pipeline, coalescing/backpressure invariants, benchmark + perf spec usage                                                                                             |
| [docs/testing.md](docs/testing.md)                                               | TDD workflow, determinism, real dependencies over mocks, test organization                                                                                                             |
| [docs/mobile-testing.md](docs/mobile-testing.md)                                 | Maestro and mobile test workflows                                                                                                                                                      |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md)                   | Isolated in-process daemon test harness                                                                                                                                                |
| [docs/browser-capture-harness.md](docs/browser-capture-harness.md)               | Real-Electron browser screenshot harness and compositor-surface gotcha                                                                                                                 |
| [docs/android.md](docs/android.md)                                               | App variants, local/cloud builds, EAS workflows                                                                                                                                        |
| [docs/docker.md](docs/docker.md)                                                 | Running the daemon and bundled web UI in Docker, volumes, agent images, security                                                                                                       |
| [docs/release.md](docs/release.md)                                               | Release playbook, draft releases, completion checklist                                                                                                                                 |
| [docs/fork-release-guide.md](docs/fork-release-guide.md)                         | This fork's own release infra — what's pointed at Draek2077/otto-code vs. still upstream, EAS/Play Store/Cloudflare/domain setup gaps                                                  |
| [docs/terminal-activity.md](docs/terminal-activity.md)                           | Terminal activity indicators — source-agnostic tracker, agent hook reporting, adding a new hook provider                                                                               |
| [docs/timeline-sync.md](docs/timeline-sync.md)                                   | Agent chat delivery paths — live events vs timeline backfill                                                                                                                           |
| [docs/i18n.md](docs/i18n.md)                                                     | Client UI translations in `packages/app/src/i18n`                                                                                                                                      |
| [docs/opencode-global-event-baseline.md](docs/opencode-global-event-baseline.md) | OpenCode global event verification baseline (dated snapshot)                                                                                                                           |
| [SECURITY.md](SECURITY.md)                                                       | Relay threat model, E2E encryption, DNS rebinding, agent auth                                                                                                                          |

## Projects

Active or reference project plans, one folder per initiative:

| Project                                                                                                                      | What's in it                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [projects/observed-subagents/observed-subagents.md](projects/observed-subagents/observed-subagents.md)                       | Charter: promote provider-managed subagents (Claude Task/ultracode fan-out) to read-only, separately-watchable track rows — provider-agnostic. Claude proof shipped; `provider-adapters.md` plans the remaining providers + the docs/ fold-in      |
| [projects/session-decomposition/session-decomposition-plan.md](projects/session-decomposition/session-decomposition-plan.md) | Plan to decompose `session.ts`'s god-class into per-domain controllers, mirroring `TerminalSessionController`                                                                                                                                      |
| [projects/text-editor/text-editor.md](projects/text-editor/text-editor.md)                                                   | Charter: IDE-grade text editing — CodeMirror 6 editor tabs, daemon-owned file RPCs (WSL-safe), disk sync, project search/replace, ctags-style Lezer navigation, AI refactor via a real Otto agent                                                  |
| [projects/file-rendering/file-rendering.md](projects/file-rendering/file-rendering.md)                                       | Charter: IDE-grade file rendering — mermaid diagrams (fences + .mmd files), relative images in repo markdown, CSV table view, Jupyter notebooks, markdown polish; task lists + native SVG already shipped                                          |
| [projects/web-search-providers/web-search-providers.md](projects/web-search-providers/web-search-providers.md)               | Charter: selectable engine for the openai-compat provider's built-in `web_search` tool (free, no-key engines first) — surfaced in the OpenAI-Compatible provider settings panel, not host-wide; current DDG implementation map + engine candidates |

## Quick start

```bash
npm run dev                          # Start the dev daemon
npm run dev:win                      # Windows: daemon (localhost:6868) + Expo together via scripts/dev.ps1
npm run dev:app                      # Start Expo against the dev daemon
npm run dev:desktop                  # Start Electron desktop dev
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with oxfmt
npm run format:check                 # Check formatting without writing
```

Repo dev commands use checkout-local state by default. In this checkout, `OTTO_HOME` resolves to `.dev/otto-home`, and `npm run cli -- ...` targets that same dev home automatically. The packaged desktop app and production-style daemon keep using `~/.otto` on port `6868`.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Otto daemon on port 6868 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
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

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Electron is still the Metro `web` platform, but desktop dev/build sets `OTTO_WEB_PLATFORM=electron`, so Metro first looks for `.electron.*` files and falls back to normal `.web.*` files. Use this when the implementation depends on Electron-only behavior such as `webviewTag`, desktop preload APIs, or the Electron bridge. Keep plain browser web in `.web.*`, and keep native fallbacks in the base file or `.native.*`.
  ```
  components/
    browser-pane.electron.tsx ← Electron <webview> implementation
    browser-pane.web.tsx      ← plain web fallback
    browser-pane.tsx          ← native fallback
  ```
  Import as `@/components/browser-pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $OTTO_HOME/daemon.log
