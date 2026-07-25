# Editor repo conventions

**Status:** charter, 2026-07-25. Nothing built.

Otto's editor currently imposes its own conventions on every file it opens. The repo has already
stated what it wants — in `.editorconfig`, in a formatter config, in a linter config — and we ignore
all of it. Open a 4-space Python project in Otto and press Tab: you get whatever Otto decided.

That is the whole problem. **A repo that has stated its conventions should have them honoured without
anyone configuring Otto.**

Distinct from [lsp-code-intelligence](../lsp-code-intelligence/lsp-code-intelligence.md), which is
about a language server _understanding_ code. This is about the editor _typing_ code the way the
project already agreed to. They share nothing but the file tab.

---

## What the repo already tells us

Ordered by how universal the file is, which is also the build order.

| Source                                                  | What it settles                                                                | Reach                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| `.editorconfig`                                         | indent style + width, final newline, trailing whitespace, charset, line length | Every language, any repo |
| `.prettierrc` / `oxfmt` / `.rustfmt.toml` / `pyproject` | width, quotes, semicolons — and a **format command**                           | Per ecosystem            |
| `.oxlintrc.json` / `eslint.config.*`                    | lint rules — **already covered by the LSP diagnostics path**, not this         | JS/TS                    |

**`.editorconfig` is the whole of phase 1**, and it is the piece worth having on its own. It is a
tiny, stable, deliberately language-agnostic format; it is the one file that is present in
mixed-language repos; and the settings it carries (tabs vs spaces, and how many) are exactly the ones
that make an editor feel wrong when they are missing. Nothing else on this list has that ratio.

Linting is explicitly **not** in scope: `oxlint --lsp` already delivers rule violations as
diagnostics through the language-server path. Duplicating it here would produce two sources of the
same warning.

---

## Shape

Reading the file belongs on the **daemon**, not the client — same reasoning as everything else in
Otto: the file is on the daemon's machine, `.editorconfig` resolution walks _up_ the directory tree
from the opened file to the nearest `root = true`, and the client has no filesystem there. So a
capability plus an RPC, resolved per file:

```
client ──code.conventions.request { cwd, path }──► daemon ──walk up, merge sections──► .editorconfig
       ◄─{ indentStyle, indentWidth, insertFinalNewline, … }─
```

Resolved per **file**, not per workspace, because `.editorconfig` is glob-scoped: a repo routinely
says 2 spaces for `*.ts` and tabs for `Makefile` in the same file. A per-workspace answer would be
wrong for exactly the repos that bothered to configure this.

### Open questions, in the order they need answering

1. **Precedence against the user's own preferences.** Otto has device-local editor prefs today
   (`editor-prefs-store`: word wrap, ruler column). If a repo says 4 spaces and the user's setting
   says 2, who wins? The defensible answer is **the repo wins for repo-shaped settings**
   (indentation, final newline — properties of the file, which the whole team shares) and **the user
   wins for view-shaped settings** (word wrap, ruler — properties of looking at it, nobody else's
   business). That line needs stating once and then holding.
2. **Whether an override is needed at all**, and if so where it lives. Resist a per-workspace
   override until someone actually wants one; the point of this feature is that it needs no
   configuring.
3. **Dependency or hand-rolled.** `editorconfig` on npm is the reference implementation and handles
   the glob semantics, which are more subtle than they look (`{js,ts}` braces, `**`, `!`). Reading it
   by hand is the kind of thing that works on the first three repos and then quietly mis-scopes a
   section. Lean toward the dependency; the same argument as `vscode-jsonrpc`.
4. **CM6 wiring.** Indent unit is `indentUnit` from `@codemirror/language`, in a `Compartment` so it
   can be reconfigured per file without a remount — the pattern `themeCompartment` and
   `wrapCompartment` already establish in `editor-core.ts`. `insertFinalNewline` and
   `trimTrailingWhitespace` are save-path concerns, not editing ones, and belong wherever the save
   happens rather than in the editor.

### Phases

1. **`.editorconfig`, end to end.** Daemon resolution + RPC + capability gate, `indentUnit` and tab
   size in the editor, final-newline and trailing-whitespace on save. This is the shippable unit.
2. **Show it.** The status bar already reads `Ln/Col`; add the active convention (`Spaces: 4`) so a
   user can see the repo's rule was picked up rather than guessing. Wrong-but-silent is the failure
   mode this prevents.
3. **Format on demand, from the repo's own formatter.** A "Format document" action that runs what the
   project runs — oxfmt here, prettier elsewhere, `dotnet format`, `ruff format`. Bigger than it
   looks: it needs a per-ecosystem command registry with the same workspace-first discovery ladder as
   the language-server rows, and it must never invent a formatter a project did not choose. Probably
   its own charter by the time it is real.

## Risks

- **Silently wrong is worse than absent.** If we read `.editorconfig` and mis-scope a glob, the
  editor now types the wrong thing _with authority_. Phase 2's status-bar readout is the mitigation
  and should not be deferred far behind phase 1.
- **Precedence, if left unstated, will be re-litigated every time someone touches this.** Decide
  question 1 before writing code, not after.
