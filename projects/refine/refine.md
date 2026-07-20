# Refine — charter

> Point-in-time build plan. **Refine** is an AI rewrite loop with review built in: open a file, say
> what you want changed, see the result as a diff against the original, keep the parts you want,
> re-run with a new instruction as many times as it takes, then accept — or walk away and the file is
> untouched.
>
> **Status: charter only — no code yet.**
>
> Grew out of [projects/context-management/context-management.md](../context-management/context-management.md) §7.4,
> which deferred AI compaction precisely because this loop did not exist. Context compaction becomes
> Refine's first preset, not a bespoke feature.

---

## 1. Mission

The AI rewrite is the operation people actually reach for, and it is the one Otto currently supports
worst. Today "Refactor with AI" pre-fills a chat draft and walks away; whatever happens to the file
happens through the agent's own Edit tool, unreviewed, in a separate tab.

Refine closes that loop. The invariant that makes it safe is simple:

> **The AI proposes. The file does not change until the user accepts.**

Everything else in this document exists to serve that sentence.

Refine is **document-general**, not context-specific. Context Management consumes it; so can prose
tightening, doc restructuring, or anything else that is "rewrite this file, let me check the work."
Per the fork's rule, the first consumer is the proof, not the finish line.

---

## 2. What already exists (and what does not)

Confirmed by exploration. The "does not exist" half is the load-bearing part.

| Need                             | Status                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text-to-text diff                | ✅ `buildLineDiff(oldText, newText)` — `utils/tool-call-parsers.ts:137`, pure LCS + word-level segments, **git-independent**                                                          |
| Diff rendering                   | ✅ `DiffViewer({ diffLines })` — `components/diff-viewer.tsx:127`, takes a flat `DiffLine[]`, decoupled from git                                                                      |
| Conditional file write           | ✅ `file.write.request` with `expectedModifiedAt` + `expectedHash`; conflict response carries current disk content (`messages.ts:3237`, `use-editor-buffer.ts:102`)                   |
| One-shot AI with no chat tab     | ✅ **daemon-side only** — `generateStructuredAgentResponseWithFallback` (`agent-response-loop.ts:404`) with `persistSession: false` + `internal: true`, as the auto-title writer uses |
| Writer-role provider selection   | ✅ `resolveStructuredGenerationProviders({ role: "writer" })`                                                                                                                         |
| File view modes                  | ✅ `FileViewMode = "editor" \| "split" \| "preview"`, persisted per file                                                                                                              |
| **Hunk grouping**                | ❌ `buildLineDiff` returns a **flat** `DiffLine[]` — no `@@`, no `oldStart`/`newStart`. Hunks exist only on the daemon's git path                                                     |
| **Per-hunk interaction**         | ❌ Nothing in the app stages, reverts, or toggles a hunk. `checkout.git.rollback` is file-level                                                                                       |
| **Client-facing generation RPC** | ❌ Every one-shot generator is invoked from daemon code. There is no door from the app                                                                                                |
| **File content snapshots**       | ❌ No checkpoint store. `EditorBufferBaseline` is single-depth; `agent.rewind` is provider-owned and agent-scoped                                                                     |

**AI Refactor is not a foundation.** `use-ai-refactor.ts` seeds a composer draft and opens a chat tab
(`:60-89`); there is no return path, no diff, no write. Only `buildRefactorPrompt`'s scope-guard idea
survives into Refine. Refine supersedes it for document rewriting; see §12 for what happens to the
existing button.

---

## 3. The state model

Four values, and the discipline is that only the last one is ever written.

```
base        the file content pinned when the session opened, with its hash + mtime
proposal    the AI's latest whole-document output
decisions   per-hunk keep/drop over diff(base, proposal)
result      base with kept hunks applied   ← the only thing Accept writes
```

### 3.1 The diff is always against `base`

Never against the previous proposal. The user's reference point is _the file as it was_, so total
change stays visible no matter how many rounds have run. This is also the guardrail against drift:
five rounds of "tighten it further" can wander, and a base-pinned diff makes that obvious instead of
hiding it behind incremental deltas.

### 3.2 Regeneration feeds `result` back in, and resets decisions

Three candidate semantics, and the choice matters:

|     | Input to the model                   | Verdict                                                                                                                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `base` every time                    | This is **Start over**. Correct as an explicit escape, wrong as the default — it throws away every decision the user made.                        |
| B   | previous `proposal`                  | **Rejected.** Compounds the model's own output round after round with no fixed reference.                                                         |
| C   | current `result` (base + kept hunks) | **Default.** What the user kept is already in the document, so the next round builds on it without a constraint-prompt that the model may ignore. |

Under (C), decisions do not need to survive a round — what was kept is baked into the input, so the
new diff starts with **every hunk on**. That sidesteps hunk identity entirely: there is no need to
match a hunk across regenerations, because there is nothing to carry.

Dropped hunks may legitimately reappear (the model still thinks it is a good idea). That is correct
behavior, not a bug: drop it again, or say why in the next instruction.

### 3.3 Exits

- **Accept** — conditional-write `result`, then the session ends and the file reloads normally.
- **Start over** — regenerate from `base`, decisions cleared.
- **Abandon** — discard everything. The file was never touched.

There is no partial-accept-then-continue in v1 (§11).

---

## 4. The missing primitive: hunks

`buildLineDiff` gives a flat list. Accept/reject needs groups. One new pure module,
`packages/app/src/refine/hunks.ts`:

```ts
interface RefineHunk {
  id: string; // stable within a proposal: index is enough, nothing carries across rounds
  lines: DiffLine[]; // the contiguous run, including its surrounding context lines
  additions: number;
  removals: number;
}

function groupDiffHunks(lines: DiffLine[], contextLines?: number): RefineHunk[];
function applyHunks(base: string, hunks: RefineHunk[], keptIds: ReadonlySet<string>): string;
```

`groupDiffHunks` walks the flat list, starts a hunk at the first non-context line, and closes it after
`contextLines` (default 3) consecutive context lines. `applyHunks` replays the diff: context lines
always taken; inside a kept hunk take additions and drop removals; inside a dropped hunk take removals
and drop additions.

**Gotcha to encode in the tests:** `DiffLine.content` includes the leading `+`/`-`/space character
(`tool-call-parsers.ts:9`). Applying must strip it, and a round-trip test must prove it.

Two properties pin correctness and belong in the first commit:

- `applyHunks(base, hunks, ∅) === base` — keeping nothing is a no-op.
- `applyHunks(base, hunks, all) === proposal` — keeping everything reproduces the AI's output exactly.

If those two hold, every intermediate selection is structurally sound.

---

## 5. Where the AI runs

Daemon-side, one-shot, invisible. `generateStructuredAgentResponseWithFallback` with
`persistSession: false` and `agentConfigOverrides: { internal: true }` — the auto-title writer's exact
shape. This matters more than it sounds: the loop is meant to be re-run freely, and a version that
spawns a visible chat tab per round is a version nobody runs twice.

Provider comes from `resolveStructuredGenerationProviders({ role: "writer" })`, so Refine honors the
host's Writer personality and the `metadataGeneration.enabled === false` opt-out, consistent with
every other one-shot generator.

Structured output: `{ content: string }`. The schema is what stops the model from returning a
chatty preamble around the document.

**New RPC** (the door that does not exist today):

```
file.refine.request   { requestId, cwd, path, base, instruction, presetId?, providerId?, modelId? }
file.refine.response  { requestId, result: { status: "ok", content } | { status: "error", message } }
```

`base` travels from the client rather than being re-read on the daemon, so the model rewrites exactly
what the user is looking at. Gated by `serverInfo.features.refine` with the usual COMPAT tag.

---

## 6. The surface: a fourth view mode

Refine is a mode on the existing file tab, not a new tab or a modal. `FileViewMode` gains `"refine"`
alongside `editor | split | preview`, with a fourth button in `FileViewModeBar`.

```
┌──────────────────────────────────────────────────────────┐
│ [edit] [split] [preview] [refine]        Round 2 · ~4.1K  │
├──────────────────────────────────────────────────────────┤
│  Instruction ▸ "keep every rule, cut the repetition"     │
│  [ Refine ]  [ Start over ]  [ Abandon ]      [ Accept ] │
├──────────────────────────────────────────────────────────┤
│  ▾ Hunk 1  −12 +4                              [ keep ]  │
│    (DiffViewer over this hunk's lines)                   │
│  ▾ Hunk 2  −3  +9                              [ drop ]  │
│    …                                                     │
└──────────────────────────────────────────────────────────┘
```

- Each hunk renders through the existing `DiffViewer` with its own `DiffLine[]` — no new diff
  renderer, only a per-hunk wrapper and a toggle.
- The header shows the round number and the resulting size delta, so the user can see whether the
  thing they asked for actually happened.
- **`"refine"` must not persist.** `file-view-store` writes the raw mode string per file; rehydrating
  into refine with no live session would render an empty shell. Clamp it back to `editor` in
  `resolveEffectiveMode` when no session is active.
- Compact form factor: the instruction bar and hunk list stack; the toggle stays a full-width row
  rather than a hover affordance (hover does not exist on native).

---

## 7. Presets

A preset is a named, pre-seeded instruction the user can still edit. It is the mechanism by which
Refine becomes context-aware without hard-coding project knowledge.

| Preset                   | Instruction seed                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Compact context file** | Compress this file: remove redundancy and duplicated guidance, keep every distinct instruction, fact and convention intact in meaning, preserve structure and headings. Do not add or invent content. **Instructions are load-bearing — never drop a rule.** |
| **Compact memory index** | One line per entry; move detail into the entry file. Preserve every entry.                                                                                                                                                                                   |
| **Tighten prose**        | Reduce length without losing meaning. No new claims.                                                                                                                                                                                                         |

The first two are what Context Management §7.4 was waiting for. `buildRefinePrompt` lives beside
`refactor-prompt.ts` as a pure, unit-tested function, and inherits its scope-guard discipline.

---

## 8. Safety

- **Nothing is written before Accept.** Not on generate, not on toggle, not on regenerate.
- **Accept goes through the conditional write** (`expectedModifiedAt` + `expectedHash` from the pinned
  base). If the file changed underneath the session, the daemon returns `conflict` with the current
  disk content and the user chooses: reload and restart the session, or abandon. Never a silent
  overwrite.
- **Abandon is free** and always available.
- **A dirty editor buffer blocks entry.** Refine pins `base` from disk; starting it over unsaved edits
  would silently discard them. Prompt to save or discard first.
- **Global-scope files still confirm.** A `~/.claude/CLAUDE.md` accepted through Refine changes every
  project on the machine — the Context Management confirm (§10.3 there) applies here too.

---

## 9. Phases

- **Phase 0 — the pure core.** `hunks.ts`: `groupDiffHunks` + `applyHunks`, with the two round-trip
  properties from §4 and the `+`/`-` prefix gotcha covered. No UI, no wire. This is the piece that has
  to be right; everything else is plumbing around it.
- **Phase 1 — daemon + protocol.** `file.refine.*`, the session handler calling
  `generateStructuredAgentResponseWithFallback` with the writer role, `features.refine`, client method.
- **Phase 2 — the refine mode.** Fourth `FileViewMode`, instruction bar, per-hunk toggles over
  `DiffViewer`, the three exits, conditional-write Accept including the conflict path.
- **Phase 3 — presets.** `buildRefinePrompt` + the §7 table, surfaced as quick-actions in the
  instruction bar.
- **Phase 4 — Context Management integration.** Its per-file action opens the file in refine mode with
  the matching preset pre-seeded, closing that charter's §7.4.

Phases 0–2 are the shippable proof; a Refine that only takes free-text instructions is already the
feature. Presets make it fast.

---

## 10. Testing

- `groupDiffHunks` / `applyHunks`: pure unit tests, including the two properties, an empty diff, a
  pure-addition file, a pure-deletion file, adjacent hunks that nearly merge, and CRLF input.
- `buildRefinePrompt`: pure test — preset text present, scope guard present, user instruction not
  mangled.
- Conflict path: ad-hoc daemon harness — write the file underneath an open session, assert Accept
  surfaces a conflict and does not overwrite.
- Back-compat: old daemon without `features.refine` → the refine mode button is absent and the mode
  clamps to `editor`.
- Per the repo rule, run only the changed file (`npx vitest run <file> --bail=1`).

---

## 11. Deferred

- **Streaming output.** v1 waits for the whole document with a progress state. A long file is a long
  wait; streaming is a real improvement but needs a streaming variant of the generation primitive,
  which does not exist.
- **Selection-scoped refine.** v1 is whole-file. Refining just a selection is the natural sequel and
  is what would finally make Context Management's "demote a rule to a subdirectory" tractable.
- **Cumulative accept across rounds.** Deliberately out (§3.2) — it reintroduces hunk identity across
  regenerations for little gain.
- **Multi-file refine.** One document per session.
- **A generic content checkpoint store.** Refine's pinned `base` is session-local. A real undo history
  is a bigger, separate feature.
- **Cost guard.** Whole-file rewrites are expensive on large files. The instruction bar should show an
  estimate before the first round; a hard block on very large files is a possible later addition.

---

## 12. Open questions

- **What happens to "Refactor with AI"?** **Decided (2026-07-19): the button is off the editor
  toolbar.** A plain document editor does not need an AI action in it — and this one in particular
  promised a scoped document edit while enforcing nothing: it handed a prompt to a full agent with
  complete tool access, which can range far past the file the user is reviewing, with no diff.

  The wand button and its dialog are removed from `file-tab-pane.tsx`; the `@/editor/refactor-*`
  modules stay on disk (`buildRefactorPrompt`'s scope-guard text feeds §7), and the e2e spec covering
  the button is `test.skip`-ed with a pointer here. No feature flag: this is a placement decision, not
  a toggle anyone needs.

  Still open: whether an AI action returns to this toolbar at all once Refine exists, or whether
  Refine is only ever reached from a surface that already knows what it is rewriting (the Context tab,
  a preset). Leaning toward the latter — an AI button on a generic editor is exactly the affordance
  that invites unscoped edits.

- **Should Refine ever touch code files?** The loop is file-type agnostic, but the value is highest on
  prose and instruction files. No technical gate is proposed; the presets simply do not target code.
- **Round history.** Keeping previous proposals would let the user step back a round. Cheap to store,
  unclear whether anyone wants it over just re-running.

---

## 13. File-touch map (for the build)

**App**

- `packages/app/src/refine/hunks.ts` — **new**, the pure core
- `packages/app/src/refine/refine-prompt.ts` — **new**, `buildRefinePrompt` + presets
- `packages/app/src/refine/use-refine-session.ts` — **new**, the §3 state machine
- `packages/app/src/refine/refine-pane.tsx` — **new**, instruction bar + hunk list
- `packages/app/src/components/file-view-mode-bar.tsx` + `stores/file-view-store.ts` — fourth mode
- `packages/app/src/components/file-tab-pane.tsx` — render the refine branch, clamp in `resolveEffectiveMode`
- `packages/app/src/components/diff-viewer.tsx` — reused unchanged
- `packages/app/src/utils/tool-call-parsers.ts` — `buildLineDiff` reused unchanged

**Protocol**

- `packages/protocol/src/messages.ts` — `file.refine.request` / `.response`, `features.refine` (COMPAT-tagged)

**Daemon**

- `packages/server/src/server/session.ts` — the refine handler
- `packages/server/src/server/agent/agent-response-loop.ts` — reused unchanged
- `packages/server/src/server/agent/structured-generation-providers.ts` — reused, `role: "writer"`
