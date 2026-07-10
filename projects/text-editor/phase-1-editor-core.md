# Phase 1 — Editor core: task breakdown

Parent charter: [text-editor.md](./text-editor.md). Tasks are ordered within tracks; Track A has no client dependencies and lands first. Every task ends green on `npm run typecheck` + `npm run lint`, with `npm run format` before commit.

**Status: implemented (2026-07-09).** All twelve tasks below landed. Notable deltas from the plan:

- The conflict UX is an inline banner (Reload from disk / Overwrite / Keep editing) instead of a modal dialog — fewer interruptions, and Overwrite is itself a conditional write against the disk identity the user was shown.
- The buffer store keeps a debounced `draft` mirror of the live document so host remounts and native webview crashes cannot lose edits (saves still round-trip `getDoc` for the exact buffer).
- The native webview bundle is minified (`build:editor-webview`), unlike the terminal's, since it ships inline in the app bundle.
- `writeFileAtomic` gained an optional `mode` so saved executables keep their permission bits.
- Hash is first-class: reads return `sha256` + detected EOL, saves precondition on hash when known (mtime as fallback), mixed-EOL files normalize to the dominant ending on save (documented majority rule).

Known gaps deferred to later phases: bulk tab closes ("close others/all") bypass the per-tab dirty guard; editor buffers do not survive a full app reload; files outside the workspace root (and `~`-scoped paths) are viewer-only by design; binary files are rejected with a clear error.

## Track A — Protocol + daemon foundation

1. **Protocol schemas.** `file.write.request` / `file.write.response` (dotted namespace per [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md)): request `{ cwd, path, content, expectedModifiedAt, expectedHash? , requestId }`; response is a tagged result — `ok { modifiedAt, hash, size }` | `conflict { modifiedAt, hash }` | `error { message }` (discriminated union, no plain unions). Add optional `eol: "lf" | "crlf"` to `FileExplorerFileSchema`. Add `features.textEditor` with a `COMPAT(textEditor)` comment. Regenerate zod-aot inbound validation per [docs/protocol-validation.md](../../docs/protocol-validation.md).
2. **Daemon write handler.** Path containment under `workspaceRoot` (reuse the explorer's normalization), UTF-8 only, mtime/hash precondition check, EOL preservation (content arrives LF-normalized from the editor; daemon re-applies the file's detected EOL), atomic write per [docs/data-model.md](../../docs/data-model.md). EOL detection added to the read path. Tests through the ad-hoc daemon harness ([docs/ad-hoc-daemon-testing.md](../../docs/ad-hoc-daemon-testing.md)): happy path, conflict, containment escape attempt, CRLF round-trip.
3. **Client library.** `writeFile(...)` on the daemon client + exported types; `features.textEditor` surfaced. `npm run build:client` so app typecheck sees fresh declarations.

## Track B — Editor engine (parallel with A)

4. **CM6 setup module.** Add `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search` to the app (`@codemirror/language` + Lezer parsers already ship via `@otto-code/highlight`). One framework-agnostic module: extensions (line numbers, history, language from `getParserForFile`, search), theme built from Otto tokens ([docs/design.md](../../docs/design.md)), and a typed command surface (getDoc/setDoc, find/replace ops, dirty events) that both hosts drive.
5. **Web host.** `code-editor.web.tsx` — direct DOM mount (web + Electron), props: initial doc + language + callbacks.
6. **Native host.** `editor-webview-entry.ts` + `scripts/build-editor-webview-html.mjs` (mirror [build-terminal-webview-html.mjs](../../packages/app/scripts/build-terminal-webview-html.mjs)) + `code-editor.native.tsx` hosting the generated HTML in `react-native-webview` with a message bridge speaking the same typed command surface as the web host.

## Track C — App integration (depends on A + B)

7. **Tab kind.** `{ kind: "editor"; path: string }` in the workspace-tabs store: target type, normalization, persistence coercion, dedupe key. Panel registration with descriptor (filename label, dirty indicator) and `confirmClose` → discard-changes dialog when dirty.
8. **Editor store.** Zustand store keyed `(serverId, workspaceStateKey, path)`: baseline `{ content, modifiedAt, hash, eol }`, dirty flag, save/revert/reload actions. Save sends preconditions; `conflict` result opens the v1 dialog ("File changed on disk — reload to continue" / overwrite). Revert re-fetches and resets baseline. Pure unit tests for the reducer logic.
9. **Toolbar + find/replace strip.** Save (mod+S) + Revert + dirty dot; JetBrains-layout find strip driving the CM6 search API: find field with match count, prev/next, match case, whole word, regex; expandable replace row (Replace / Replace All). Compact form factor: find + prev/next + match case only, "Replace all in file" via action sheet ([charter: Mobile](./text-editor.md#mobile-limited-by-design)). Hover rules per [docs/hover.md](../../docs/hover.md).
10. **Entry points + gating.** File explorer context menu "Edit", Text viewer toolbar "Edit" button. Both check `features.textEditor` once (single detection point) — absent flag shows "Update the host to use this."
11. **i18n.** English strings in `en.ts`, parity keys in all locale files (type-enforced; translation pass deferred until the feature is verified).
12. **E2E + verification.** Playwright spec: open editor from explorer → type → dirty dot → save → daemon file content asserted → revert → close-with-dirty prompts. Typecheck/lint/format; targeted vitest files only.

## Deferred to later phases (do not build here)

Disk-change watching and the three-way conflict banner (Phase 2); project search/replace (Phase 3); file finder, symbol index, outline, go-to-definition (Phase 4); AI refactor + gutter line-range selection (Phase 5); line comments (Phase 6).
