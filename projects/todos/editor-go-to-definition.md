# TODO: Editor go-to-definition client bridge + multi-hit picker

**From:** text-editor, the one deferred nav item (Phases 1–5 shipped and verified; the daemon half of
go-to-definition is **already shipped and tested** — only the editor client bridge is unwired). See
[docs/text-editor.md](../../docs/text-editor.md). **Size:** medium, client-side.

## Current state (verified)

- **Daemon side is done.** The symbol index + lookup shipped under `features.codeIndex`:
  - `code.symbols` RPC (and `code.outline`, `code.list_files`) in
    `packages/server/src/server/session/files/workspace-files-session.ts` + `session.ts`; symbol
    extraction via `extractSymbols` from `@otto-code/highlight` (Lezer trees), lazy per-workspace
    index with a 30s TTL, invalidated on writes/replaces. `findCodeSymbols` is shipped and unit-tested.
- **Client side is missing.** `code.symbols` / `findCodeSymbols` are **not called anywhere in
  `packages/app/src`**. The editor has no word-under-cursor → lookup → jump path. (The only
  `definition` references in `editor/editor-core.ts` are Lezer highlight tags, unrelated.)

## Task

1. Add a **word-under-cursor** command to the editor. Phase 5 already added a `getSelection` editor
   command (`packages/app/src/editor/` — see `use-ai-refactor.ts` for how it reads editor state); add
   a sibling that resolves the identifier under the caret.
2. On "Go to definition" (bind a key / add an action near the existing editor actions), call the
   `code.symbols` RPC via the daemon client (`daemon-client.ts` hosting/code RPCs) with that
   identifier for the current workspace.
3. **Multi-hit picker.** When `findCodeSymbols` returns >1 match, show a small JetBrains-style picker
   (reuse the `refactor-dialog.tsx` dialog pattern from Phase 5) listing file + line; single hit jumps
   directly. Selecting a hit opens the target file at the symbol's line (the file-tab open path
   already supports `:line`).
4. Gate the whole action on `features.codeIndex` (hide it when absent — no fallback path).

## Verify

Put the caret on a symbol and invoke go-to-definition: a single definition jumps straight to the
file+line; multiple definitions show the picker and jumping to any opens the right file at the right
line; a symbol with no index hit shows a graceful "no definition found" rather than an error.

## Scope note

The **read-only-viewer gutter line-range touch selection** (the charter's hard mobile requirement,
deep CM6/viewer work) and **direct agent auto-spawn** (touches the central agent-creation path while
unattended) are the text-editor project's _larger_ deferred items — they stay in the text-editor
charter, not this task.

## Compat

`code.symbols` already ships behind `features.codeIndex` with its `COMPAT(...)` marker; the client
just needs to gate on that flag. No new protocol surface.
