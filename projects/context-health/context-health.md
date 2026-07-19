# Context Health — charter

> Point-in-time build plan. Detect the per-project **context files** that get ingested into every
> model request (CLAUDE.md, memory, AGENTS.md, skills…), measure them, and **warn the user with an
> amber chip at the top of chat** when they're oversized — with a path to act (open → AI-compact) or
> dismiss. Grew out of [projects/token-cost-audit/token-cost-audit.md](../token-cost-audit/token-cost-audit.md),
> which measured this repo's root `CLAUDE.md ≈ 6K tokens` and `MEMORY.md` as fixed per-request tax.
>
> **Status: charter only — no code yet.** Decisions locked with the user (2026-07-18): provider-aware
> scan · action = warn → open → reuse+enhance AI Refactor as the compaction path · plan-first.

## 1. Mission

A user shouldn't discover their context bloat on their bill. Otto already knows the workspace and the
active provider; it should scan the context files that provider actually loads, size them, and — when
one is too large — surface a **non-blocking amber warning** at the top of the chat (the same surface
suggested-task chips use), letting the user open the file, run an AI-assisted compaction over it, or
dismiss. This is the visibility half of the token-cost work: [total-token-accounting](../total-token-accounting/total-token-accounting.md)
owns "what did this chat cost"; Context Health owns "what fixed weight are you carrying every turn."

## 2. The load-bearing constraint (from exploration)

**Otto has zero visibility into which context files a provider loads.** Every provider (Claude SDK,
Codex, OpenCode, ACP, Pi) ingests CLAUDE.md / AGENTS.md / memory / skills **internally**; the daemon
only passes flags (`settingSources: [user, project, local]` + the `claude_code` preset at
`providers/claude/agent.ts:3320-3325`) and never sees the file list, contents, or sizes. A repo-wide
grep for any code reading CLAUDE.md/AGENTS.md/MEMORY.md as context returns nothing.

**⇒ Detection must be a daemon-side filesystem scanner** that walks the workspace cwd + project root
and applies each provider's **known conventions**. This is tractable and has a direct precedent:
`listCodexSkills()` (`codex-app-server-agent.ts:673-705`) already walks cwd/parent/repo-root/`$CODEX_HOME`
for `.codex/skills/*/SKILL.md`. We model the scanner on it.

Corollary: the numbers are **estimates** (chars ÷ 4 via the existing `estimateTokens` in
`agent/context-composition.ts:11`) and **best-effort per-convention** — we tell the user "these are the
files your provider _conventionally_ loads," not "these exact bytes were sent." That honesty is stated
in the chip copy. Real tokenization is out of scope (no tokenizer in the daemon).

## 3. Scan scope — provider-aware conventions

The scanner keys off the **active agent's provider** and walks from `workspace.cwd` up to the project
root (`ProjectRegistry.rootPath` / `WorkspaceGitService.resolveRepoRoot(cwd)`), plus the user-home
locations each provider reads.

| Provider                                   | Files it conventionally loads                                                                                                                                                                                                                                            | Walk roots                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **Claude** (proof provider)                | `CLAUDE.md` at **user** (`~/.claude/CLAUDE.md`), **project** (repo root), **local** (`CLAUDE.local.md`); files those `@import`; the memory dir (`~/.claude/projects/<enc>/memory/MEMORY.md` + entries — this repo's convention); `.claude/skills/*/SKILL.md` frontmatter | cwd → repo root; `~/.claude`   |
| **Codex**                                  | `AGENTS.md` (cwd → repo root); `.codex/skills/*/SKILL.md`; `$CODEX_HOME/AGENTS.md`                                                                                                                                                                                       | cwd → repo root; `$CODEX_HOME` |
| **OpenCode**                               | `AGENTS.md`; `.opencode/` instructions                                                                                                                                                                                                                                   | cwd → repo root                |
| **Pi**                                     | none by convention (system prompt only)                                                                                                                                                                                                                                  | —                              |
| **openai-compat**                          | **none** — pure API, ingests no project files                                                                                                                                                                                                                            | —                              |
| **ACP** (Copilot/Cursor/Kiro/Trae/generic) | agent-subprocess-owned; **daemon has zero visibility** → scan **not offered**, chip explains why                                                                                                                                                                         | —                              |

**`@import` / transitive resolution (Claude):** v1 resolves one level of explicit `@path` imports and
the repo's `MEMORY.md` convention (a file _referenced by_ CLAUDE.md). Deep/recursive import graphs are
deferred (§11) — we flag the top-level offenders, which is where the tokens are.

**Non-goal:** we never claim a provider loads a file it doesn't. openai-compat/ACP surfaces show "no
project context files are ingested on this provider" rather than a false alarm — that itself is useful
signal (matches the audit: openai-compat's weight is the tool catalog + history, not context files).

## 4. Data model

Daemon-computed, per workspace (+ provider). Nothing new persisted server-side beyond the dismissal
watermark (§9).

```
ContextFile {
  path: string            // absolute, daemon-side
  relPath: string         // display, relative to project root or ~
  role: "claude_md" | "memory" | "agents_md" | "skill" | "imported"
  bytes: number
  estTokens: number       // estimateTokens(bytes) — chars/4
  severity: "ok" | "notice" | "warn"   // per §5 thresholds
}
ContextHealthReport {
  workspaceId: string
  provider: string
  scannedAt: string
  supported: boolean      // false for ACP/openai-compat → "not applicable" copy
  files: ContextFile[]
  totalEstTokens: number
  aggregateSeverity: "ok" | "notice" | "warn"
  worst: ContextFile | null
}
```

Wire schema mirrors this in `packages/protocol/src/messages.ts` (all fields additive/optional per the
back-compat rule). `severity` is a string enum, `z.discriminatedUnion` not needed (flat record).

## 5. Thresholds (defaults; configurable)

Daemon config (hot-reloadable via `MutableDaemonConfig`, the pattern rate-limit-warnings/speech use),
with a client settings UI. Defaults chosen against real data (this repo: root CLAUDE.md ≈ 6K tok,
MEMORY.md ≈ 5K tok, both clearly worth flagging; a <1K CLAUDE.md should stay silent):

| Level                     | Per-file est. tokens | Aggregate est. tokens |
| ------------------------- | -------------------: | --------------------: |
| `ok` (silent)             |              < 2,000 |               < 6,000 |
| `notice` (amber, low-key) |          2,000–5,999 |          6,000–11,999 |
| `warn` (amber, prominent) |              ≥ 6,000 |              ≥ 12,000 |

Only `notice`/`warn` raise a chip. A single `warn` file, or a `warn` aggregate, drives the prominent
style. Thresholds live in `config.contextHealth.{fileWarn,fileNotice,aggregateWarn,aggregateNotice}`.

## 6. When the scanner runs

- On **agent focus / workspace open** (the chip is per focused chat, like suggested tasks are per
  `parentAgentId`). Debounced.
- On **context-file change** — reuse the daemon file-watch (`file.watch.*`, the `artifact-watcher.ts`
  pattern) on the resolved context-file set, so editing CLAUDE.md re-scans and the chip updates/clears
  live. Watch only the small resolved set, cleaned up on unfocus/socket close.
- **Cached** per `(workspaceId, provider)` with the resolved file set; invalidated on watch events.
  Scans are cheap (a handful of `stat`+small reads), but caching keeps focus switches instant.

No scanning when `features.contextHealth` is off or the provider is unsupported.

## 7. Protocol

Follows [rpc-namespacing.md](../../docs/rpc-namespacing.md) and the suggested-tasks precedent exactly.

- **Feature gate:** `serverInfo.features.contextHealth: z.boolean().optional()` in `messages.ts:~3586`
  with `// COMPAT(contextHealth): added in vX.Y, drop the gate when floor >= vX.Y`. Advertised `true`
  in `websocket-server.ts:~1372`. Client reads `features?.contextHealth === true`.
- **Push notification (daemon→client):** `context_health_changed` — payload
  `{ workspaceId, report: ContextHealthReport | null }`. Full-report reconciliation, same shape/idiom
  as `suggested_tasks_changed` (flat name, like other `*_changed` pushes). Internal daemon event
  `context_health_state` → translated in `session.ts` next to the suggested-task translation
  (`session.ts:1369-1377`).
- **Dismiss RPC:** `context.health.dismiss.request` / `.response` — `{ workspaceId, fingerprint }`
  (fingerprint = hash of the flagged file set + their size-buckets, so a dismissal sticks until a file
  grows past the next watermark; see §9). Response under `payload`, `requestId` correlated.
- **Recompute RPC (optional):** `context.health.rescan.request` / `.response` for a manual refresh
  button. Low priority.

No client→daemon "open file" or "refactor" RPCs needed — those reuse existing editor/file infra (§8).

## 8. The action path — warn → open → AI-compact (all reuse)

The chip's actions, in order, each reusing shipped infrastructure:

1. **Warn** — the amber chip names the worst file + its est. tokens ("CLAUDE.md — ~6.1K tokens, loaded
   every request").
2. **Open** — tap opens the file as a unified **`file` tab** (`file-tab-pane.tsx` / `FileViewModeBar`,
   editor mode), to the side of the chat (reuse the existing side-open placement,
   `resolveSideFileOpenPlacement`). Requires `features.textEditor`; if off, the chip's open action is
   hidden and it stays a warn/dismiss chip. The daemon read is the existing `file_explorer_request`.
3. **AI-compact** — inside the editor, the existing **"Refactor with AI" (Sparkles)** action, but with
   a new **context-compaction preset**. This is the user's "enhance the refactor to include new
   contextual things":
   - Add `buildContextCompactionPrompt` alongside the pure, unit-tested `refactor-prompt.ts`
     (`buildRefactorPrompt`) — scope = **whole file**, instruction seeded to _"Compress this context
     file: remove redundancy and dead/duplicated guidance, keep every distinct instruction, fact,
     and convention verbatim in meaning, preserve structure and headings. Do not add or invent
     content."_ Role-aware: a `CLAUDE.md`/`AGENTS.md` preset stresses "instructions are load-bearing —
     never drop a rule"; a `MEMORY.md` preset stresses "one line per entry, move detail to topic files"
     (mirrors the memory-index compaction convention).
   - Surface it as a preset in `refactor-dialog.tsx` (a "Compact context file" quick-action that
     pre-seeds the instruction; the user can still edit it).
   - **Unchanged safe-core invariants:** it opens a **pre-filled draft tab** via the draft store
     (`use-ai-refactor.ts`); the user reviews provider/model and sends; **no auto-spawn, no
     auto-overwrite** (the compacted result comes back as an editor edit the user saves through the
     conditional-write path). This is why "compaction" is safe even for hand-authored CLAUDE.md.
4. **Dismiss** — server-authoritative, like suggested-task dismissal.

## 9. Dismissal persistence

A dismissal must **stick across restart** but **re-warn if the file keeps growing**. Store a per-`(workspaceId,
fingerprint)` dismissal where the fingerprint buckets each flagged file's size — so dismissing a
6.1K CLAUDE.md silences it, but the same file at 9K produces a new fingerprint and re-warns. Home:
the per-workspace client store keyed by `workspaceId` (device-local, the review-draft-store precedent,
`data-model.md:534-543`) — no daemon schema needed, and dismissal is inherently a presentation choice.
(Authoritative-across-devices via the agent record's `labels`/`config.extra` is the fallback if we
later want it synced; not for v1.)

## 10. Surfacing & gating

- **UI:** a new `ContextHealthChip` mounted in `agent-panel.tsx` `contentContainer` (lines 1249-1256),
  a sibling of the suggested-tasks overlay, reusing the `overlayWrap`/`card` layout from
  `suggested-tasks/overlay.tsx:434-453` but themed amber: `theme.colors.statusWarning` for
  border/foreground, `hexColorWithAlpha(statusWarning, 0.1)` background — the exact tint the "Auto
  mode"/moderate tier uses (`composer/agent-controls/mode-control.tsx:260`). Canonical amber primitive
  `<StatusBadge variant="warning">` where a pill fits. When both a suggested-tasks overlay and a
  context chip are present, stack them (context chip above or below by product call — default: context
  chip on top, it's about the whole session not a follow-up).
- **Feature flag:** gated feature `contextHealth` in `features/feature-catalog.ts` with a settings
  toggle (device-local `featureEnabled`, sparse, defaults on) **and** the daemon `features.contextHealth`
  capability. Client shows the chip only when both the daemon advertises it and the user hasn't turned
  it off. (This is a lightweight surface, not a heavy lazy panel, so the Metro lazy-split dance in
  feature-flags.md doesn't apply — it's a plain gated render.)

## 11. Phased build plan

- **Phase 0 — daemon scanner (Claude).** `context-health-scanner.ts`: resolve Claude's conventional
  file set for a `(cwd, projectRoot)`, `stat`+read, `estimateTokens`, produce `ContextHealthReport`.
  Pure, unit-tested against a temp fixture tree. No wire, no UI yet.
- **Phase 1 — protocol + notification + chip.** Wire schema, `features.contextHealth`,
  `context_health_changed` push, session translation, client store slice + selector, the amber
  `ContextHealthChip` (warn + dismiss only). End-to-end in the real app: oversize this repo's CLAUDE.md
  → chip appears.
- **Phase 2 — the action path.** "Open" (file tab, side placement) + the AI-compaction refactor preset
  (`buildContextCompactionPrompt` + dialog quick-action). Dismissal fingerprint/persistence.
- **Phase 3 — other providers.** Codex (AGENTS.md + skills), OpenCode; the "not applicable" copy for
  openai-compat/ACP. Provider-convention table becomes a small registry.
- **Phase 4 — config + polish.** Settings UI for thresholds (daemon config, hot reload), manual rescan,
  aggregate roll-up copy, file-watch live updates.

Ship Phase 0–2 (Claude) as the proof, per Otto's "single-provider as proof, not finish line" rule.

## 12. Testing

- Scanner: pure unit tests over a temp fixture tree (files at user/project/local, an `@import`, a
  `MEMORY.md`, a skill) asserting resolved set + severities; matches `refactor-prompt.test.ts` /
  `workspace-files-session.test.ts` style. Run only the changed file (`npx vitest run <file> --bail=1`).
- Protocol round-trip via the ad-hoc daemon harness ([ad-hoc-daemon-testing.md](../../docs/ad-hoc-daemon-testing.md)).
- `buildContextCompactionPrompt`: pure unit test (scope-guard text present, role-specific clauses).
- Back-compat: old client parses new `features.contextHealth`/notification; old daemon (no flag) →
  client hides the chip.

## 13. Open questions / deferred

- **Deep `@import` graphs** (recursive, glob imports) — v1 does one level + the MEMORY.md convention.
- **Real tokenization** — stays chars/4; revisit only if users report the estimate misleads.
- **Cross-device dismissal sync** — v1 is device-local; agent-record `labels` is the sync path if wanted.
- **Auto-compaction (no review)** — explicitly **out**: the safe-core routes through composer/draft
  review; never auto-overwrite a user's CLAUDE.md.
- **Scan on every provider vs active only** — v1 scans the active provider; a "worst across all
  configured providers" roll-up is a possible Phase 4+ enrichment.
- **Chip vs settings-screen surface** — v1 is the in-chat chip (as requested); a project-settings
  "Context health" panel listing all files with sizes is a natural companion (defer).

## 14. Concrete file-touch map (for the build)

Daemon

- `packages/server/src/server/agent/context-health/context-health-scanner.ts` — **new**, the scanner.
- `packages/server/src/server/agent/context-health/provider-conventions.ts` — **new**, per-provider file-set registry.
- `packages/server/src/server/agent/context-composition.ts:11` — reuse `estimateTokens`.
- `packages/server/src/server/workspace-registry.ts` (`rootPath`/`cwd`) + `workspace-git-service.ts:172` (`resolveRepoRoot`) — walk roots.
- `packages/server/src/server/session.ts:~1369` — translate internal event → `context_health_changed` (next to suggested-tasks).
- `packages/server/src/server/session/files/workspace-files-session.ts` — reuse `file.watch.*` for live re-scan.
- `packages/server/src/server/websocket-server.ts:~1372` — advertise `features.contextHealth`.

Protocol

- `packages/protocol/src/messages.ts` — `ContextFileSchema`, `ContextHealthReportSchema`,
  `context_health_changed` (outbound union + exported types), `context.health.dismiss.request/.response`,
  `features.contextHealth` (COMPAT-tagged).

App

- `packages/app/src/context-health/` — **new**: `chip.tsx`, `select.ts`, `use-context-health-actions.ts` (mirrors `suggested-tasks/`).
- `packages/app/src/stores/session-store.ts` — new `contextHealth` slice + reconcile on notification.
- `packages/app/src/contexts/session-context.tsx` — `client.on("context_health_changed", …)`.
- `packages/app/src/panels/agent-panel.tsx:1249-1256` — mount `ContextHealthChip`.
- `packages/app/src/editor/refactor-prompt.ts` + `refactor-dialog.tsx` + `use-ai-refactor.ts` — add `buildContextCompactionPrompt` + the "Compact context file" preset.
- `packages/app/src/features/feature-catalog.ts` + a settings section — the `contextHealth` gated feature toggle.
- `packages/app/src/styles/theme.ts` — reuse `statusWarning`; no new token.
