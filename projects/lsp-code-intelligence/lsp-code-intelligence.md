# LSP code intelligence

**Status:** **PHASE 5 COMPLETE** (2026-07-25) — 5a hover, 5b diagnostics, 5c references tab, 5d rename job tab. Phases 1-3 shipped earlier. Go-to-definition resolves a position
through a real language server, with the ctags index as the no-server fallback; hover explains the
symbol under the pointer; and **problems are marked, explained, and live** — squiggle, gutter glyph,
and the server's own words on hover. **Daemon → Code** carries the master switch, per-language rows
with honest cost copy, and the running-servers table.

**Phase 4 (Angular) is deferred indefinitely** — see the Phases section for why and for the
framework taxonomy that makes it decidable; the multi-server binding it existed to prove now has a
real production user in the `oxlint` row.

**The blocking defect that gated 5d's Apply is fixed** — see "Phases 5c and 5d, as built" below. Its
root cause was a client capability we never advertised, not a limitation of tsserver.

**Verified live against a real daemon** (2026-07-25) by driving the WebSocket directly against this
repo as the workspace:

| Checked                         | Result                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon boot with the new wiring | Clean — zero errors in `daemon.log`                                                                                                                                    |
| `server_info.features.lsp`      | `true`                                                                                                                                                                 |
| `lsp.servers.list`              | typescript via **workspaceBin** (the repo's own copy — the ladder working for real), python + csharp via **path**, angular not installed and off                       |
| `code.document.sync`            | `ok`                                                                                                                                                                   |
| Activity push                   | `busyRoots: [repo]` then `[]` — the sidebar spinner's signal fires over the real socket                                                                                |
| `code.definition`               | `status: ok`, resolved `uri.ts:58:56` (a call site) → `uri.ts:44:17`, which is exactly `fromFileUri` in its `export function` declaration, attributed `via typescript` |

Still unverified: the editor UI itself and the Daemon → Code screen have no test and have not been
clicked through — only the RPCs beneath them.

Supersedes the ctags-based half of
[docs/text-editor.md](../../docs/text-editor.md)'s "Go to definition" section.

Replace name-based go-to-definition with a real Language Server Protocol client in the daemon, and
open the door to hover, find-references, rename, and diagnostics behind the same machinery.

---

## Phase 1, as built

Landed in `packages/server/src/server/lsp/` — 64 tests, lint and scoped typecheck
clean, and a real `typescript-language-server` handshake against a fixture workspace:

| File            | What it owns                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `uri.ts`        | `file://` ↔ path over Node's WHATWG conversion, plus `documentKey` — the canonical identity that keeps `c:` and `C:` one file |
| `connection.ts` | One live server: spawn, `vscode-jsonrpc` stdio channel, handshake, per-request timeouts, exit reporting                       |
| `registry.ts`   | The language rows and the workspace-first discovery ladder                                                                    |
| `pool.ts`       | Running servers keyed by (workspace × server): lazy spawn, idle reap, LRU cap, capped-backoff restart, document binding       |

Decisions Phase 1 settled that the sections below predate:

- **Node's stdlib is enough for URIs.** `pathToFileURL`/`fileURLToPath` round-trip drive letters,
  UNC, `\\wsl$\`, spaces, unicode and `#` exactly, and accept both `file:///C:/…` and
  `file:///c%3A/…`. No `vscode-uri` dependency. What stdlib does _not_ give is identity — a server
  may echo a document back in the equivalent-but-different spelling, so every map is keyed on
  `documentKey`, never a raw URI.
- **`shell: true` is the wrong way to run a `.cmd` shim.** It concatenates argv unescaped, so the
  first workspace under `C:\My Projects\` splits into garbage. `planLanguageServerSpawn` invokes
  ComSpec with `/d /s /c` and explicit quoting instead; a spaced-path test covers it.
- **`typescript-language-server` 5.3 sends no `serverInfo`** — only `capabilities`. It is optional
  in LSP; do not assert on it.
- **The pool holds no timers.** Every decision reads an injected clock, which is what makes
  idle/backoff behaviour testable without waiting on wall time. The other half of that bargain is
  that the daemon must supply the tick — see "The lifecycle wiring, as built" below, which is where
  it was owed for several phases and not paid.

The C# handshake question is **settled** — see the Languages section, which also corrects the
binary this charter originally named.

## Phases 2 and 3, as built

Phase 2 (`documents.ts`) and Phase 3's daemon + client path landed the same day.

| Piece                  | Where                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document mirror + sync | `lsp/documents.ts` — didOpen/didChange/didClose, per-document versions, fan-out to every bound server                                                                           |
| Definition service     | `lsp/service.ts` — fan-out, merge/dedupe by (path, line, column), the three-valued status                                                                                       |
| RPCs                   | `code.definition`, `code.document.sync`, `code.document.close` + `features.lsp` in `server_info`                                                                                |
| Daemon handlers        | `workspace-files-session.ts`, beside the ctags `code.symbols` handler, behind the same workspace guard                                                                          |
| Client                 | `findCodeDefinition` / `syncCodeDocument` / `closeCodeDocument` in `daemon-client.ts`                                                                                           |
| Editor                 | `use-definition-sources.ts` (one hook answering "what can serve a definition"), and `use-go-to-definition.ts` now tries a position first and falls back to the name-based index |

Further decisions these phases settled:

- **The charter's Phase 2 premise was wrong: there was no daemon-side buffer mirror to tap.**
  `onDocSync` writes to a client-side Zustand store (`setDraft` in `use-editor-buffer.ts`) and no RPC
  carried the draft anywhere. Phase 2 therefore _built_ the mirror — `code.document.sync` — rather
  than subscribing to one. See the corrected section below.
- **The wire is 1-based; LSP is 0-based.** Positions on `code.definition` match `CodeSymbolLocation`
  and the rest of Otto. `service.ts` is the only place that converts.
- **A lazily-spawned server is sent `didOpen` with the current text, never a replayed `didChange`.**
  Servers start on the first query, long after the edits. The per-document record tracks _which
  connection_ holds it open, so a crashed-and-restarted server is re-opened rather than sent changes
  against a baseline it never saw.
- **"Indexing" is a real signal, not a timer.** `LspConnection.isIndexing` counts in-flight
  `$/progress` begin/end pairs from the server. An empty result while a server is indexing reports
  `indexing`; an empty result otherwise reports `ok` with no locations.
- **The ctags index is the designed fallback, not a compat shim.** The client falls through to
  `code.symbols` only on `unavailable` (no server for this language on the host). `ok` with zero
  locations is authoritative and is _not_ retried against ctags.
- **`z.object`, not `looseObject`, for LSP reply parsing.** A loose object's index signature collapses
  the narrowed `Location | LocationLink` union to `unknown`. `LocationLink` prefers
  `targetSelectionRange` so the caret lands on the identifier rather than the doc comment above it.
- **The pool is daemon-scoped, created in `websocket-server.ts`.** Language servers are expensive
  processes keyed by workspace; a per-session pool would spawn a duplicate set per connected client.

## The settings surface, as built

`MutableDaemonConfig.lsp` (master switch, sparse per-language map, limits) + `lsp.servers.list` /
`lsp.server.stop` for live state, rendered by `screens/settings/code-intelligence-section.tsx` under
a new **Code** host section.

- **Config and live state are separate RPCs on purpose.** Which languages are enabled is
  configuration and round-trips through the existing daemon-config pair; which servers this host can
  actually supply and which are running is not, and belongs in its own request.
- **`languages` is sparse, and an absent key means "use the row's default".** A row added later
  therefore ships with its intended default instead of reading as disabled by an older config file.
- **`defaultEnabled` lives on the registry row, not in the config.** TypeScript, Python and C# ship
  **on** — a language that has to be switched on before it works has not been shipped. Angular ships
  off (Phase 4 is unfinished), and so should anything with a heavy index (rust-analyzer, clangd).
- **The master switch defaults on, and that is safe** because spawning is lazy: an unused language
  costs nothing. What the switch guarantees is that off means off _now_ —
  `applySettings` stops what is already running rather than waiting for an idle timeout, or the
  switch is decoration.
- **Availability is scoped to a workspace** because it genuinely varies by one: a server can sit in
  one project's `node_modules` and be absent from another's. With no workspace open the screen says
  so instead of guessing.
- The running table is a real table (server / workspace / uptime / Stop), per the repo's
  "data needs a table, not a card" rule.

---

## The lifecycle wiring, as built (2026-07-25)

The pool's cost controls were written, tested and then **not called**. `reapIdle`,
`setActiveWorkspace`, `stopWorkspace` and `stopAll` had zero production call sites through Phase 5:
a repo-wide grep found them only in `pool.test.ts`, `service.test.ts` and e2e teardowns. Everything
this charter says above about idle exit, background reap and archive/shutdown teardown was therefore
describing tests, not the daemon. The only thing actually bounding the process count was
`enforceRunningCap` — the LRU cap, which is a backstop, not a policy.

The failure mode is worth naming because it is not a bug in any one file. "The pool holds no timers"
is a correct testability decision; what it does is **move an obligation out of the subsystem**, and
nothing in the subsystem can fail when the obligation is not met. Every unit test still passed.

| Obligation                    | Who pays it now                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The idle tick                 | `websocket-server.ts` — `startLspIdleReapInterval`, every 30s, `unref`'d, cleared in `close()`                              |
| Which workspace is "active"   | `LspService.setActiveWorkspace`, called from its own request path (`syncDocument` + `capableServersFor`)                    |
| Teardown on workspace archive | `archiveByScope` via the `stopLanguageServers` dependency, gated on the same last-reference rule the directory removal uses |
| Teardown on daemon shutdown   | `websocket-server.close()` → `lspService.stopAll()`                                                                         |

- **The active workspace is derived, not pushed.** There is no focus signal on the wire, and adding
  one would give the idle policy a second source of truth — the one that goes stale is the one that
  leaves servers running. Every code-intelligence request already _is_ a focus signal: a hover, a
  definition lookup or a buffer sync only happens for the file someone is looking at. This is what
  finally makes `backgroundIdleMinutes` mean anything; until it was wired, `activeWorkspaceKey`
  stayed `null` forever and every server got the long allowance.
- **Archive teardown is keyed by directory, not by workspace record**, because that is how a server
  is keyed. Two workspace records over one `cwd` mean archiving the first must not stop the servers
  the second is still using — the same predicate (`isDirectoryUnreferenced`) that decides whether
  the worktree directory itself may be removed. Project removal archives workspaces without going
  through `archiveByScope`, so it calls the shared helper directly.
- **None of the teardown may fail an archive.** The archive has already happened by the time the
  servers are stopped; a server that refuses to die is logged and left to the reaper.
- The regression guard is `websocket-server.lsp-lifecycle.test.ts` — that the daemon ticks and that
  shutdown stops everything. Not what the pool does with the tick, which `pool.test.ts` already owns.

---

## Why the current one has to go

Go-to-definition today asks the daemon for "every symbol anywhere named `foo`"
(`WorkspaceSymbolIndex` in `server/file-explorer/code-index.ts`). Two failures, one root cause.

**It is slow because the index is rebuilt on the user's click.** A lookup that misses the cache walks
up to 5,000 gitignore-filtered files **serially** — `await options.onFile(...)` in
`walkWorkspaceFiles` — and each file is a `stat`, a `readFile`, a full Lezer parse and a tree walk.
The cache TTL is 30s and **any** file write into the workspace invalidates the whole thing
(`workspace-files-session.ts`, the `symbolIndex.invalidate(cwd)` calls). Otto exists to run agents
that write files, so the index is cold nearly every press. The cost is paid in the foreground, per
lookup, forever — it never amortizes.

**It cannot answer the question, at any speed.** The index is `name → locations`, built from whatever
the syntax highlighter's _definition_ classes happened to tag. No imports, no scopes, no types. It
can tell you what things are called `foo`; it cannot tell you which `foo` **this** `foo` refers to.
That is why a picker exists (the index genuinely cannot choose) and why "not found" is a routine
answer (anything the highlighter doesn't tag is invisible). Tuning cannot fix this — it is what a
ctags map is.

The replacement has to resolve _the reference under the cursor_. That is what a language server does.

---

## Shape

```
editor buffer ──didOpen/didChange──┐
                                   ▼
  client ──code.definition.request──► daemon ──JSON-RPC/stdio──► language server
         ◄─code.definition.response─         ◄─textDocument/definition─
```

Three parts, in build order: a daemon-side LSP client (transport + lifecycle), document sync from the
live editor buffer, then the definition RPC and the client rewiring.

### Position, not a word

The current hook sends `getWordAtCursor()` — a string. The new one sends a **position**
(`{ path, line, column }`) and the server resolves it in context. `getWordAtCursor` stays only for
whatever else wants a word; the definition path stops guessing from text.

### Answer against the buffer, not the disk

The editor usually has unsaved edits, and a definition lookup against stale disk content is a subtly
wrong answer. This is the piece that makes the feature _correct_ rather than _approximately correct_.

> **Corrected 2026-07-24.** This section originally claimed Otto already mirrors the buffer to the
> daemon via `onDocSync` (debounced 750ms, "built for crash recovery") and that the mirror could
> simply become the document-sync feed. **It could not: there was no daemon-side mirror.** `onDocSync`
> calls `setDraft` on a client-side Zustand store (`editor-buffer-store.ts`) and nothing sent the
> draft over the wire — `grep draft` across `packages/server` and `daemon-client.ts` found nothing.
>
> Phase 2 therefore built the transport: `code.document.sync.request` carries the buffer text, and the
> client sends it immediately before a definition lookup rather than on a debounce of its own. Tab
> close sends `code.document.close`. Full-text sync, as planned.

---

## Indexing: the actual trade, and the policy that answers it

Yes, most language servers index. That is the honest cost, and it is the opposite shape from today's:

|             | today (ctags)             | language server         |
| ----------- | ------------------------- | ----------------------- |
| when        | every lookup              | once per session        |
| where       | foreground, on your click | background, after spawn |
| after that  | same cost again           | ~10ms, forever          |
| correctness | name match                | resolved reference      |

Per-server reality, so the settings copy can be honest:

| server                                | index cost                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| JSON / CSS / HTML / Bash              | **none** — per-document, no project model                                       |
| pyright, gopls                        | seconds                                                                         |
| typescript-language-server (tsserver) | seconds to ~30s cold on a repo this size; 1–4GB resident                        |
| clangd                                | background **on-disk** index; needs `compile_commands.json` to be useful at all |
| rust-analyzer                         | the expensive one — minutes cold, re-runs on dependency changes                 |

What people object to is _invisible, always-on, unbounded_ indexing. So the policy is part of the
feature, not an afterthought:

- **Lazy spawn.** No server starts until a code-intelligence action needs that language in that
  workspace. Never open Rust, never pay for rust-analyzer.
- **Per-language opt-in**, with the cost above stated next to each toggle. Default-on only for the
  no-index tier plus TypeScript.
- **Idle shutdown.** Unused server exits after N minutes; memory comes back.
- **Visible.** "Indexing TypeScript (first run)…" with elapsed time — never a spinner that reads as
  hung. A user who sees what they are paying for tolerates it; one who doesn't, doesn't.
- **A zero-index tier.** The ctags index stays (it honestly serves the outline and fuzzy finder) and
  is the answer for anyone who wants no servers at all — see [Fallback](#fallback).

---

## How many processes, and what they cost

### The keying, and why it can't be shared

A server process is keyed by **(workspace root × server)**. Not per language — Angular means one
language can bind two servers — and **not shareable across workspaces**: a language server is
initialized against one `rootUri` and builds its project model from that root. tsserver for project A
has no knowledge of project B and cannot be asked about it. That is protocol, not a choice we get to
make.

So the ceiling is `Σ over open workspaces (servers actually touched in that workspace)`:

| situation                                | processes                     |
| ---------------------------------------- | ----------------------------- |
| one workspace, you only opened `.ts`     | 1                             |
| Angular app (`.ts` + templates + styles) | 2–4 (ts, ngserver, html, css) |
| polyglot repo: TS + Python + C#          | 3                             |
| three such workspaces open at once       | **9, if nothing reaps them**  |

Nine servers is several gigabytes. That number is the whole reason the controls below exist — the
feature is not "spawn language servers", it is "spawn the fewest that answer the question."

### The lever: you only look at one workspace at a time

That observation is the design, not an aside. Three mechanisms exploit it, and together they mean the
realistic steady state is **the active workspace's servers only** — usually 1–3 processes:

1. **Lazy spawn.** Nothing starts until you open or query a file of that language _in that
   workspace_. Three open workspaces where you've only touched TypeScript in one = one process.
2. **Background workspaces reap fast.** A workspace that stops being the active one starts a short
   idle timer (default 2 min) instead of the normal long one (default 10 min). Switch away, get the
   memory back; switch back, pay a warm-up you asked for by switching.
3. **A hard global cap.** "Max running language servers" (default 6), LRU-evicted. This is the
   backstop that makes the worst case _bounded_ rather than _unlikely_ — no combination of
   workspaces, languages and bad luck can multiply past it.

### Expected cost — to be measured, not trusted

Ballpark idle resident memory per server. **Phase 1 measures these on real projects and the settings
screen shows live numbers**; nothing here should be quoted as fact until it is:

| server                     | rough idle RSS | notes                                      |
| -------------------------- | -------------- | ------------------------------------------ |
| JSON / CSS / HTML / Bash   | ~30–80 MB      | no project model; effectively free         |
| pyright                    | ~150–400 MB    | scales with import graph                   |
| gopls                      | ~200 MB–1 GB   |                                            |
| typescript-language-server | ~300 MB–2 GB+  | it is tsserver; scales with the TS program |
| roslyn-language-server     | ~300 MB–1.5 GB | a full Roslyn workspace, on .NET           |
| rust-analyzer              | ~1–4 GB        | the outlier                                |

CPU is a spike during the initial index, then ≈0 at idle, with a small burst per `didChange` — and
those are already debounced to 750ms by the existing buffer mirror. Warm definition latency should be
single-digit to low-tens of milliseconds.

**This competes with the agents.** The daemon runs on the same machine as the coding agents Otto
exists to run; a 2GB tsserver is 2GB the models don't get. That is the argument for the cap being a
default, not an expert setting.

---

## Settings: Daemon → Code

A new daemon settings section, because these are daemon-side processes on the daemon's machine —
they follow the host, not the client.

**Global**

- **Code intelligence** — master switch. Off means no server ever spawns, for any workspace; the
  ctags fallback still serves the outline and fuzzy finder.
- **Per-language rows** — enable/disable each, showing: current state (running / installed / not
  found), its index cost in plain words, and — for a Tier B server that isn't installed — the exact
  install command behind a consent button. Default-on for the no-index rows plus TypeScript.
- **Limits** — max running servers (LRU cap), idle shutdown minutes, background-workspace idle
  minutes.

**Per-project override**

Every workspace can say **Use global / Off / Only these languages**. Off is absolute for that
project: no server spawns for it no matter what the global defaults say. This is the answer for the
one giant repo that would drag tsserver to 4GB while the rest of your projects behave.

**A running-servers table**, not a card: workspace, server, state, uptime, resident memory, with a
Stop button per row. The point is that a user who suspects the daemon is hogging memory can see
exactly what is running and kill it, without guessing. Same idiom as the other daemon data screens —
full-width table, list and detail together.

---

## Languages

After the core exists a language is a **registry row** — id, extensions, command, discovery ladder,
init options — not code. The count is cheap; reachability on the user's machine is what varies.

### The three that decide whether this shipped

**TypeScript/JavaScript, Python, and C# are not "tier one", they are the acceptance criteria.** A
release that does not do all three well has not solved the problem, whatever else it supports.

| Must          | Server                                                     | Launch                                                                 | Acquisition                                                                         |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TS/JS/TSX/JSX | `typescript-language-server --stdio`                       | resolve the workspace's own TypeScript so the answer matches its build | workspace `node_modules/.bin` → our dep → PATH                                      |
| Python        | `pyright-langserver --stdio`                               | plain                                                                  | our dep → PATH                                                                      |
| C#            | `csharp-ls` (stdio is its default — **no** `--stdio` flag) | plain stdio                                                            | `dotnet tool install -g csharp-ls`, then PATH — **user-consented, never automatic** |

> **SETTLED 2026-07-24, and the charter was wrong about the binary.** Verified empirically, see
> `csharp-server.e2e.test.ts`.
>
> **There is no `roslyn-language-server` wrapper to install.** It is not on nuget.org (`dotnet tool
search roslyn` does not list it) and not on npm. `dotnet tool install -g roslyn-language-server`
> fails with "not found in NuGet feeds" — and note it **exits 0 while failing**, so a naive install
> step would report success. Raw `Microsoft.CodeAnalysis.LanguageServer.win-x64` is not installable
> as a global tool either, including from the Azure `vs-impl` feed; the editors that consume Roslyn
> directly download and unpack that nupkg themselves, which is a bootstrap we are not writing.
>
> **`csharp-ls` is the row that works** — a real dotnet global tool on nuget.org (0.26.0, ~1.3M
> downloads, Roslyn-based, the same one Neovim/Helix users reach for).
>
> **No `solution/open` bootstrap is needed, so C# needs no per-language hook.** It initializes as an
> ordinary stdio server against all three project shapes: a loose folder with no project file at
> all, a classic `.sln`, and .NET 10's new `.slnx`. It finds and loads the project itself, and takes
> an optional `--solution` if we ever need to point it at one. The registry-row model holds.
>
> It advertises `definitionProvider`, `hoverProvider`, `referencesProvider` and `renameProvider`, so
> Phase 5's payoff is available in C# and not just TypeScript. Unlike
> `typescript-language-server` it **does** send `serverInfo`.
>
> Incidental finding worth carrying into solution discovery: **.NET 10's `dotnet new sln` emits
> `.slnx`, not `.sln`.** Anything that detects "is this a solution repo" must match both.

### Frameworks — the thing a language row alone doesn't give you

| Framework   | What's needed                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React**   | Nothing extra. JSX/TSX is native to the TypeScript server; it works the moment TS does.                                                            |
| **Angular** | `ngserver --stdio --tsProbeLocations <ws>/node_modules --ngProbeLocations <ws>/node_modules`, resolved from **the workspace's own** `node_modules` |
| Vue, Svelte | Same row shape later (Volar, svelte-language-server) — not in scope, but they cost nothing new once Angular forces the design below.               |

**Angular forces an architectural decision that has to land in Phase 1.** The Angular server does not
replace the TypeScript server — both are interested in the same `.ts` file, and the Angular one
additionally owns `.html` templates and template type-checking. So the registry is **N servers per
document, not one**, and a definition request fans out to every server bound to that document with
results merged and deduped by (path, line, column). Retrofitting that after a one-server-per-language
core is expensive; designing for it up front is nearly free. It also pays for itself immediately —
`vscode-css-languageserver` and the TS server both want a `.vue`-ish future, and Razor pairs the same
way with C#.

Angular also can't be served from a dependency of ours: `ngserver` must come from the project's own
`node_modules` so its Angular version matches the app's. That makes workspace-first resolution a
core rule, not a TypeScript special case.

### The rest

| Tier                                | Languages       | Server                     | Discovery                |
| ----------------------------------- | --------------- | -------------------------- | ------------------------ |
| **Zero setup** (npm, our dep)       | JSON, JSONC     | vscode-json-languageserver | our dep                  |
|                                     | CSS, SCSS, LESS | vscode-css-languageserver  | our dep                  |
|                                     | HTML            | vscode-html-languageserver | our dep                  |
|                                     | Bash            | bash-language-server       | our dep                  |
|                                     | YAML            | yaml-language-server       | our dep                  |
| **Lights up if installed**          | Go              | gopls                      | PATH                     |
|                                     | Rust            | rust-analyzer              | PATH → rustup            |
|                                     | C, C++          | clangd                     | PATH                     |
|                                     | PHP             | intelephense               | PATH → npm               |
|                                     | Lua             | lua-language-server        | PATH                     |
|                                     | Ruby            | ruby-lsp                   | PATH                     |
| **Deferred — not "spawn and talk"** | Java            | jdtls                      | JVM + workspace data dir |
|                                     | Swift           | sourcekit-lsp              | needs Xcode              |

### Linters are language servers too — and the fan-out had to learn that

**`oxlint --lsp` is a real LSP server, and this repo already installs `oxlint`.** Verified
2026-07-25: `serverInfo` reports `oxlint 1.61.0`; it publishes diagnostics on `didOpen`; it offers
`quickfix` plus `source.fixAll.oxc` code actions; and it sends `codeDescription.href` — a link to the
rule's own documentation — which is why the tooltip can explain a lint rather than merely assert it.
It also puts its suggested fix in the message after a `\nhelp:` marker.

Shipped as a row, **discovery `workspaceBin` only**. Not a packaging accident: a linter's rules are
the project's own opinion. Falling back to our bundled copy would lint a repo that never adopted
oxlint, filling its gutter with rules its authors never chose. A repo without oxlint honestly gets
no lint diagnostics.

**This row is what forced capability-based fan-out, and it is the better design.** oxlint binds `.ts`
beside the TypeScript server but answers _only_ diagnostics. Asking it for a definition is a wasted
round-trip on a guaranteed miss — and worse, it would make the "every bound server failed" branch
fire on a request the one capable server answered fine. So `capableServersFor` filters on the
server's own advertised `definitionProvider` / `hoverProvider` / `referencesProvider` /
`renameProvider`. Reading the `initialize` reply beats a `provides:` column in the registry, which
would have been ours to keep accurate forever.

It is also the first row that binds a **second** server to a file the TypeScript server already
holds — so the multi-server design now has a production user, not just the `angularish` test stubs.

**ESLint is not shipped, and shipping it blind would be worse than the gap.** `vscode-eslint`'s
server (via `vscode-langservers-extracted`) requests real settings through
`workspace/configuration`, and this client answers `{}` for every item — enough for pyright, almost
certainly not enough for ESLint, which would then validate nothing and read as a broken row rather
than an absent one. It needs the same empirical probe `csharp-ls` got. **`tslint` is not a candidate
at all**: deprecated in 2019 and folded into `typescript-eslint`.

**Never download a binary silently.** npm servers ship as our optional dependencies; everything else
is discovered, and when it is missing the answer is an offer ("Install the C# language server?" with
the exact command shown) or a plain "no language server for Go" — never an error, never a background
download.

Note the editor's ~20 Lezer grammars (`packages/highlight/src/parsers.ts`) are independent of this:
a language can have a server without a grammar (it just won't be highlighted) and vice versa.

---

## Decisions

- **Transport:** `vscode-jsonrpc` over stdio. The daemon has no JSON-RPC/stdio client today
  (checked), and Content-Length framing is not worth hand-rolling.
- **Process model:** one server per (workspace root × server), and **a document may be bound to
  several** (Angular + TypeScript on the same `.ts`). Lazily spawned, idle-timeout exit, killed on
  workspace archive and daemon shutdown, restarted with capped backoff on crash. Every clause of
  that sentence except lazy spawn and crash backoff needed a caller outside the pool, and for
  several phases had none — see "The lifecycle wiring, as built".
- **Resolution order is workspace-first, always.** A server that type-checks the project must be the
  version the project itself installs — the workspace's `node_modules/.bin` before our bundled copy
  before PATH. Angular makes this mandatory rather than merely correct.
- **Fan-out and merge:** a definition request goes to every server bound to the document; results are
  merged and deduped by (path, line, column). One server answering is success, not a race.
- **Protocol:** `code.definition.request` / `code.definition.response` per
  [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md); capability `features.lsp` in
  `server_info`. Feature contract applies — **no fallback path**; an old daemon shows "Update the
  host to use this."
- **Multi-target:** the picker survives, but it now means something real (overloads, implementations)
  instead of "two files happen to use this name."
- **Windows and WSL are first-class, not an afterthought.** `file://` URI ↔ path conversion with
  drive letters is the classic LSP bug source, and this repo is Windows-primary with WSL file RPCs
  already in play. Round-trip conversion gets unit tests before anything else is wired.

### Fallback

The ctags index is **not** deleted: it keeps serving the outline and the fuzzy finder, where
name-matching is the honest answer. For definitions it is demoted to "no server available for this
language" — and it should first get the fix it deserves anyway: build once, then re-index **only the
written file** (the write path already knows the path) instead of invalidating the workspace.
That alone removes the latency complaint for the no-server case.

---

## Phases

Each phase is independently shippable and independently verifiable.

1. **Daemon LSP core** — `vscode-jsonrpc` stdio client, server registry with workspace-first
   discovery, **document→servers binding (many)**, per-workspace lifecycle (spawn / initialize /
   shutdown / idle exit / crash-restart), URI↔path conversion with tests, structured logging. No
   client surface yet; proven by a daemon test that spawns typescript-language-server against a
   fixture and gets an `initialize` result. **Also settles the C# handshake question above** against
   a real `.sln` repo and a loose-folder one.
2. **Document sync** — `didOpen` / `didChange` / `didClose` fed by the existing buffer mirror, keyed
   to the file tab's lifecycle, broadcast to every server bound to the document. Proven by asking for
   a definition of a symbol that exists **only in the unsaved draft**.
3. **Definition, end to end** — the RPC, the capability gate, **Daemon → Code** (master switch,
   per-language rows with honest cost copy and the consented install offer, the limits, the
   running-servers table, per-project override), the "indexing…" state, and the client rewiring from
   word to position. **The three musts land here — TypeScript, Python, C# — plus React** (free with
   TS) and the npm no-index rows.

   The off-switches ship **with** the first working language, not after it. A user who cannot turn
   this off does not get to decide whether they want it.

4. **Angular, then the rest** — `ngserver` alongside the TS server on the same documents, which is
   the first real exercise of the multi-server binding; then Go/Rust/clangd/etc. as discovery rows.

   > **Deferred indefinitely, 2026-07-25 (product owner).** Its architectural job is already done:
   > the multi-server binding is built and proven by the `angularish` stub rows in `documents.test.ts`
   > and `service.test.ts` (bind-to-many, fan-out, merge, dedupe). What remains is Angular the
   > _feature_, which pays off only for Angular projects — and by design that is now a registry row
   > plus a `defaultEnabled` flip, cheap on the day it is wanted. **Phase 5 does not depend on this.**
   >
   > The taxonomy that makes this decidable, and which the charter previously left implicit — a web
   > framework needs work here only when a file's meaning lives outside what the language's own server
   > understands:
   >
   > | Group                                               | Frameworks           | What we owe                                                                                    |
   > | --------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
   > | The framework is a library in the language          | React, Preact, Solid | **Nothing.** JSX _is_ TypeScript; `<Foo/>` is an ordinary identifier tsserver already resolves |
   > | Semantics in a companion template language          | Angular, Razor       | A **second server alongside** the first — both want the same `.ts`                             |
   > | Single-file components the base server cannot parse | Vue, Svelte          | A server that **owns** the file and proxies to tsserver (Volar, svelte-ls)                     |
   >
   > Angular is group 2 because `<app-user-card [user]="selectedUser">` is three things tsserver
   > cannot see: a **selector** mapping to a class elsewhere, an `@Input()` on that class, and a
   > property on the _current_ component's class referenced from HTML.

5. **The payoff** — hover, diagnostics, find-references, rename. Each an increment on machinery that
   already exists. This is where the cost of phases 1–2 is repaid, and it is the next work.

### Phase 5, in build order — and the UI each one needs

Ordered by value-per-cost, not by protocol tidiness. Product-owner direction, 2026-07-25.

**5a. Hover.** `code.hover` over `textDocument/hover`, rendered as an editor tooltip. Cheapest of the
four and pure reuse — it proves the Phase 5 pattern before anything expensive is built on it.

**5b. Diagnostics — with real explanations, not just squiggles.** The one item whose plumbing is
genuinely new: servers send `textDocument/publishDiagnostics` **unsolicited**, so this needs a push
channel where everything so far has been request/response. Gutter markers in the editor, and
**hovering a marker shows the full detail** — message, source, and code. A red squiggle that cannot
tell you _why_ is decoration; the compiler's own explanation is the feature.

> **BUILT 2026-07-25.** Verified against the real `oxlint --lsp`
> (`oxlint-server.e2e.test.ts`) plus 13 unit tests on the store. What it added, and the four
> decisions worth not re-litigating:
>
> | Piece                | Where                                                                                                                                             |
> | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Notification handler | `connection.ts` — `textDocument/publishDiagnostics` parsed to an envelope; `publishDiagnostics` + `codeDescriptionSupport` declared on initialize |
> | Per-document store   | `lsp/diagnostics.ts` — slice per (workspace × server), merged view, change detection                                                              |
> | Retraction           | `pool.ts` `onServerGone` → `service.retractDiagnostics`, on crash, reap and deliberate stop alike                                                 |
> | Push                 | `lsp_diagnostics_changed` status broadcast; `push-router.ts` → `stores/lsp-diagnostics-store.ts`                                                  |
> | Editor               | `editor-diagnostics.ts` — squiggle, gutter glyph column, gutter-hover tooltip, click-to-select; `editor-contract.ts` gains `setDiagnostics`       |
> | Live mirror          | `use-code-document.ts` — mirrors the buffer on every change and closes the document on unmount                                                    |
>
> - **The snapshot is the protocol, never a delta.** Both the wire payload and the editor's
>   `setDiagnostics` carry a document's whole current set. A missed delta leaves a squiggle on a line
>   the user already fixed, with nothing that will ever retract it; an idempotent snapshot cannot
>   drift. The store's change detection is what keeps that from becoming a broadcast per keystroke.
> - **Only open documents get diagnostics.** A server may hold opinions about every file in the
>   project. Nothing can render a marker in a file with no tab, and pushing the rest is unbounded.
> - **`@codemirror/lint` was rejected, and not on dependency grounds.** It owns a lint _lifecycle_
>   (a source it polls) where ours is a push, and it installs its own `hoverTooltip` — which would
>   fight the language-server hover for the same pointer rest and produce two cards for one gesture.
>   The diagnostic is rendered _into_ that one card instead, above the type signature.
> - **The `help:` split is presentation, not protocol.** oxc-family servers put the suggested fix in
>   the message after a newline. The wire keeps the message the server sent; the tooltip splits it.
>
> **First bug round, 2026-07-25 — three findings, two of them one bug:**
>
> - **Never style a CM6 gutter's layout.** CM6 sets `.cm-gutter { display:flex !important;
flex-direction:column }` — its own comment says "prevents margin collapsing" — and positions the
>   lines it skipped by setting `marginTop` on the elements it does render. A `justify-content: center`
>   of ours therefore centred the whole stack along that **vertical** main axis and parked every
>   marker hundreds of pixels from its line. Centering belongs on
>   `.cm-otto-diagnostic-gutter .cm-gutterElement`, which has a real per-line height to centre within.
> - **The missing gutter tooltip was the same bug.** `gutter({domEventHandlers})` resolves the line
>   from the pointer's Y via `lineBlockAtHeight`, so a marker drawn at the wrong Y reports a line with
>   no diagnostic on it and the tooltip is correctly empty. (`showTooltip` needs no extra wiring — the
>   facet declares `enables: [tooltipPlugin]`.) The handler now dispatches only when the hovered line
>   changes; `mousemove` fires per pixel of travel and a transaction per pixel is a redraw per pixel.
> - **A severity must carry its whole underline in one rule.** Split into a shared base plus a
>   colour-only override, the colour silently lost and every squiggle fell back to `currentColor` —
>   the editor foreground — so a real error looked like ordinary text. `diagnosticUnderline()` builds
>   each severity complete.
>
> **Severity is now legible without decoding a colour**, which is what the report was really about:
> `hint` gets a **dotted** underline rather than a wavy one (tsserver emits hints by the dozen on
> plain JavaScript, and wavy is the visual language of "broken"), and the tooltip's attribution line
> leads with the severity name — `Error · oxc · eslint(no-unused-vars)`.
>
> **Two surfaces were added in the same round:**
>
> - **Status-bar totals**, far right behind a vertical rule, one dot-and-count per severity that has
>   any. Absent entirely when there are none: a `0` would be indistinguishable from a file nothing
>   analysed — see the gap below.
> - **A problems panel** above the status bar, tinted like the out-of-project banner, listing up to
>   three problems with click-to-jump. **Errors and warnings only** — a panel that opened for hints
>   would be permanent furniture, and permanent furniture is invisible.
>
>   Its dismissal is stored as the **fingerprint of what was dismissed**, not a boolean, which is what
>   gives all three required behaviours with no persistence and no timers: dismiss hides these
>   problems, a re-evaluation finding different ones brings it back, and reopening the document brings
>   it back. Positions are excluded from the fingerprint on purpose — typing above an error moves it
>   without changing it, and a position-sensitive fingerprint would undismiss on the next keystroke.
>   Nothing is persisted anywhere: a dismissal that outlived the tab would be a way to hide an error
>   permanently.
>
> **Second bug round, 2026-07-25 — one gotcha to keep:**
>
> - **`TooltipContent` renders its children raw.** A bare string child gets no `<Text>` wrapper, so on
>   web it inherits the document's font size and comes out roughly double. Every call site must pass
>   `<Text style={…fontSize.sm}>`; `toolbar-icon-button.tsx` is the reference shape.
> - **Gutter order IS the layout**: CM6 renders gutters left to right in extension order, and puts
>   the `border-right` divider on the container around all of them. **The glyph column mounts AFTER
>   `lineNumbers()`, on the numbers' right — settled by the product owner 2026-07-25 after trying
>   both.** The reason is typographic and worth not re-litigating: line numbers are `text-align:
right`, so the **left** side of their gutter is ragged whitespace that varies with digit count,
>   and a glyph column over there floats a different distance from the digits in every file. On the
>   right it is always flush against them, so a number and its marker read as one thing.
>
>   The cost of that side is real — the numbers sit a column off the code — and is paid down by
>   width, not by moving: `DIAGNOSTIC_GUTTER_PX` is 11px, the 6px dot plus the smallest gap that
>   still reads as one, rather than a comfortable margin.
>
>   The option that would end the tradeoff, if it ever comes up again: put severity **on** the line
>   number itself (a coloured left border or coloured digits on the gutter element) and have no glyph
>   column at all — zero width, always tight, and the existing per-line gutter hover still works
>   because it resolves by line, not by element. Not built; it is a visual-design change, not a fix.
>
> - Problem totals moved **ahead of** the divider in the right-hand group, so the encoding and caret
>   readouts stay rightmost. Each total is now a tooltip trigger naming its severity (`info` reads as
>   "suggestion" — what a language server actually means by it), and each panel row carries the full
>   untruncated message plus its attribution, since the row itself clips to one line.
>
> **Known gap: "analysed and clean" is indistinguishable from "nothing analysed it."** Both show no
> counts. The fix is for `code.document.sync`'s response to report which servers bound to the
> document, which would also let the status bar name them. Not built.
>
> The panel's strings are literal English pending an i18n pass — the layout has not been reviewed yet,
> and translating an unconfirmed layout is work done twice.
>
> **This revised the lazy-spawn rule, deliberately.** `syncDocument` now binds the document to its
> servers, so opening a file starts them. Diagnostics are the one code-intelligence feature nobody
> asks for by gesture — waiting for a hover or a definition lookup would mean a broken file looked
> clean until you happened to point at it. The cost controls are unchanged and are what make it
> affordable: master switch, per-language toggles, LRU cap, idle reap. `service.test.ts` carries the
> inverted assertion and the reason.

**5c. Find references — its own results tab.** `code.references`, plus a `codeReferences` workspace
tab following `fileHistory`/`gitLog`: a real table with a pinned header, navigate to each hit
**without losing the search**. One tab per (symbol, position), for the same reason whole-file and
line-scoped history are separate tabs — a second search must not evict the first.

**5d. Rename — an auditable dry-run job in a tab.** Rename touches the whole project, so it is
treated as a **job**: take the request from the file, set the job up in its own tab, and show the
full dry run — every file and every edit it _would_ make — so the impact is visible before anything
happens. Apply is explicit and atomic; nothing is written until the user says so. This is the
opposite of the usual inline-rename-box, and deliberately: an inline box hides project-wide blast
radius behind a single keystroke.

The shared reason 5c and 5d are tabs rather than dialogs is the one `git-file-history.md` already
argues: these are working surfaces you keep open beside the code, not questions you answer and
dismiss — and a bounded card leaves a table stranded in whitespace.

### 5a/5c/5d verified live, and the one blocking defect it exposed

Probed against the real `typescript-language-server` on this repo, 2026-07-25:

| RPC                   | Result                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `code.hover`          | `ok` via `typescript` — real signature markdown: `function fromFileUri(uri: string): string` |
| `code.references`     | `ok`, 2 hits (declaration `uri.ts:44:17` + call `uri.ts:58:56`), attributed                  |
| `code.rename.preview` | `ok`, 1 file / 2 edits, first `44:17 → "pathFromFileUri"`, nothing written                   |

**The references count is wrong, and that is the finding.** `fromFileUri` is also used in
`service.ts` and `uri.posix.test.ts` — at least 4 sites across 3 files. The server reported only the
2 inside `uri.ts`, the single file that had been synced, because tsserver had not loaded the rest of
the project yet.

> **This makes the first-use grace window a correctness prerequisite for rename, not polish.** For
> a definition, a partially-loaded project means a miss the user notices and retries. For a rename
> dry run it means an **incomplete edit set presented as complete** — the tab would say "1 file, 2
> edits" for a rename that actually touches three files. That is the one place in this subsystem
> where being wrong is destructive rather than merely unhelpful.
>
> So 5d must not ship its Apply until the plan is trustworthy. Minimum bar: block the dry run behind
> a settled project (await the server's own project-load signal where it has one, else a first-use
> grace window per workspace × server), and have the tab state plainly when a plan may be partial
> rather than implying completeness. 5c wants the same guard but degrades gracefully — an
> under-reported reference list is a bad search, not a bad edit.

### Phases 5c and 5d, as built — and the root cause the charter had wrong

**The blocking defect is FIXED, and its cause was ours, not tsserver's.** This charter said
"`typescript-language-server` answers `initialize` immediately and loads the project lazily
**without reporting `$/progress`**". That was a measurement of a bug we had: **we never
advertised `window.workDoneProgress` in our client capabilities**, and the LSP spec forbids a
server from starting server-initiated progress unless the client declares it. Answering
`window/workDoneProgress/create` is not enough — the capability has to be advertised for the
server to ask at all.

One line in `initializeParams` changed the picture completely. Measured on this repo:

| elapsed   | busy       | `references` hits | files |
| --------- | ---------- | ----------------- | ----- |
| 166ms     | —          | 2                 | 1     |
| 1.47s     | **→ busy** |                   |       |
| 2.1–8.1s  | busy       | 2                 | 1     |
| **12.1s** | **→ idle** |                   |       |
| 16.2s     | idle       | **14**            | **4** |

So the truth is 14 sites in 4 files, the wrong answer persists for **~12 seconds**, and it is
now **observable** rather than guessed at. Three consequences:

- **No grace-window timer, and good riddance.** A fixed duration would have had to guess, and
  the probe shows why guessing fails twice over: 5s would be too short here, and a
  converge-until-unchanged heuristic would ALSO have been fooled — "2 hits" was stable across
  four samples spanning 7.6 seconds.
- **`indexing` now outranks having results.** The old rule only reported `indexing` for an
  _empty_ result, which is exactly backwards: a complete-looking answer that is 7× short is
  more dangerous than an empty one. `references` returns the partial set **with**
  `status: "indexing"` so the tab can show it and mark it provisional.
- **The sidebar spinner works for TypeScript now**, which this charter previously recorded as
  "correct but nearly invisible". It was invisible because nothing was ever reported.

**5c — the references tab.** `codeReferences` workspace tab, one per (path, line, column) so a
second search sits beside the first. Grouped by file, with the source line behind each hit
(one `readTextFile` per _file_, not per hit) — a reference list without the line is a list of
places to go and look, which is most of the work the list was supposed to save. The
provisional chip is driven by the `indexing` status above, and the hook re-asks with backoff
until the project settles or a 90s ceiling gives up and says so.

**5d — the rename job tab.** Context menu → a dialog for the _name only_ → a `codeRename` tab
holding the dry run → explicit Apply. The dialog is deliberately not the audit surface: one
field with one answer is a dialog's shape; "here is everything this will change" is not.

**`code.rename.apply` carries the `planId`, NOT the edits.** That is the load-bearing decision.
A request carrying its own edit list would be a remote arbitrary-write primitive wearing a
rename's name — any client could post any text at any path. Instead the daemon recomputes the
plan and passes four gates, each with a test:

1. The plan is recomputed, never trusted from the client.
2. Recomputation re-applies the indexing guard, so a preview taken while settled cannot be
   cashed in after the server starts reloading.
3. The `planId` must match, or nothing is written and the answer is `stale`.
4. **Every file must be inside the workspace.** A language server is a foreign process that
   answers in paths; one naming `../../.ssh/config` must not make the daemon write there. Any
   escape fails the whole apply before a single write. `path.relative`, not a string prefix —
   a prefix test says `/repo-evil` is inside `/repo`.

Honest limit, stated rather than papered over: writes are all-or-nothing at the _check_ stage
but not transactional at the _filesystem_ stage. An I/O failure partway leaves earlier files
written. The fix would be a journal, which a symbol rename does not warrant.

### The rename became a reversible job (2026-07-25)

**`renameApply` no longer recomputes-and-refuses. It runs the stored plan.** Product-owner
direction, and the reasoning corrects a mistake this charter made one section earlier.

The first design recomputed the plan at apply time and refused on any difference (`stale`). The
property that was protecting is real — _the client must not be the author of the edits_ — but it
was never `recompute` that provided it. Keeping the plan **daemon-side**, keyed by `planId`,
preserves it exactly while giving the user what a dry run actually promises: the edits you
approved are the edits that run.

And the refusal was wrong for this product specifically. Otto exists to run agents that write
files; "a file changed since you looked" is the **common** case here, not the exceptional one.
A gate that fires constantly is a failure mode wearing a safety mechanism's clothes.

`lsp/edit-job.ts` owns the machinery, and knows nothing about renames or language servers — a
symbol rename is one _planner_ feeding it; a file rename would be another. What it owns is the
part that is the same either way and the part that is dangerous: writing, recording what was
written, and being able to take it back. **15 tests.**

Three properties carry the design:

- **Each edit carries `oldText`** — the text it expects to replace, captured by reading the
  files at plan time. Safety moved from all-or-nothing to per-edit: a file that changed
  underneath loses only the edits whose ground truth moved, the rest still land, and the ones
  that did not are named. A file that cannot be read keeps its edits with an empty `oldText`
  rather than being dropped, because dropping it would quietly shrink the blast radius the user
  is being shown.
- **Every write is journalled** (before- and after-image), so `renameUndo` can reverse the run.
- **Undo is verified the same way as apply.** A file is restored only if it still holds exactly
  what the run wrote. Anything else means someone edited it since, and a blind restore would
  destroy that work — so it is reported as `changedSince` and left alone. That check is what
  makes undo safe rather than merely available.

`code.rename.apply`'s status is now three-valued (`ok` / `expired` / `escaped`) and **`ok` means
the run happened, not that everything applied** — `complete` and the per-file outcomes carry
that. A run where two of fourteen edits no longer fit still wrote twelve, and reporting it as a
failure would hide them, and hide the fact that there is now something to undo.

Workspace containment moved to **plan** time as well as run time: an unrunnable plan should
never be shown as if it could run.

The tab is now a job surface: plan → run → per-file report → undo → **close**. One action slot
whose meaning follows the phase, rather than Apply and Undo both on screen asking the user to
work out which is live.

**Re-planning after an undo does not work, and the tab no longer offers it (2026-07-25).**
Reported from use: undo succeeded, "Plan again" then failed and the tab was stuck. The cause is
structural, not a bug in the button. `edit-job` writes and restores files **itself** — it is the
one path in this subsystem that mutates a workspace without going through `documents.sync`, and
nothing tells the language servers. We advertise no file watchers either. So after apply, and
again after undo, a bound server's in-memory copy of those files is whatever it last saw, and a
rename planned against it is a rename of a symbol that is not there any more.

Product-owner call: an undone rename is **terminal**. The replan control is withdrawn in the
`undone` phase and the action slot becomes `Close` (`closeCurrentTab`); the user starts a fresh
rename from the file. Cheaper and more honest than a button that cannot work.

The real fix, if this is ever wanted back, is to notify the servers after a job runs — a
`workspace/didChangeWatchedFiles` for the written paths, plus a re-sync of any open document —
and it belongs in `edit-job`'s completion path, not in the rename planner. Note the cost first:
that turns every apply/undo into an LSP write-through, and both `renameApply` and `renameUndo`
would need to wait for it before the panel can plan again.

### A query must not depend on another tab being open (2026-07-25)

Reported from use: reload the client (Ctrl+R, or an HMR rebuild) with a References tab open and
it comes back **"0 references in 0 files"** for a symbol that plainly has them, and Refresh
never recovers it.

The tab was fine. The **document mirror** was the missing link. `LspDocuments.serversFor` used to
send `didOpen` only when some editor had already called `code.document.sync` for that path — and
the only caller of that is `useCodeDocument`, which lives in the **file pane**. A pane mounts
just its frontmost tab, so after a reload the References tab is on top and the source file's
editor tab never mounts, never mirrors, and the language server is asked
`textDocument/references` for a URI it was never handed. tsserver answers **empty** for that —
not an error, just nothing — so the daemon reported `ok` with zero locations and the panel said,
accurately and uselessly, "No references found." Re-asking reproduced the same state exactly.

The fix belongs in `LspDocuments`, not in the panels: `serversFor` now loads the file from disk
and registers it when nothing is mirroring it, so **every position query is self-sufficient**.
Definition, hover, references, and rename-preview all route through it, so all four stop
depending on which tab happens to be frontmost. The loaded document is kept in the map rather
than opened-and-dropped — a results tab re-asks, and the indexing poll re-asks several times.
An editor tab that mounts later takes it over on its first `sync`: identical text is a no-op, a
differing draft bumps the version and sends `didChange`. Best-effort throughout — missing,
unreadable, or over 4 MB leaves the servers unopened, which is exactly the old behaviour.

The invariant to keep: **"answers come from the draft, not the disk" means the draft when one
exists — not "only when one exists."** 4 tests in `documents.test.ts`.

### What Phase 5 owes the indexing indicator

`typescript-language-server` answers `initialize` immediately and loads the project lazily **without
reporting `$/progress`** — measured against this repo (thousands of files) on 2026-07-25: the only
busy window was the spawn. So the Daemon → Code spinner is correct but nearly invisible for
TypeScript; it shows for `pyright` and `csharp-ls`, which do report their project/solution loads.

The consequence to fix in Phase 5: a definition requested during tsserver's lazy load returns `ok`
with zero locations, i.e. **"not found" when the honest answer is "not yet"**. The fix is a
first-use grace window per (workspace × server), not more `$/progress` chasing.

## Risks

- **First-request latency on a cold server** is the thing most likely to make this feel worse than
  what it replaces if the UI lies about it. Phase 3's "indexing…" state is not polish, it is the
  feature working as designed.
- **Memory multiplication across open workspaces** is the failure mode most likely to make someone
  uninstall: three workspaces × three languages is nine processes and several gigabytes, on the same
  machine as the agents. The lazy spawn + fast background reap + hard LRU cap must all exist before
  the first language ships, not as a follow-up.
- **C# depends on a `dotnet tool install` the user must run.** Mitigated by detecting the SDK and
  offering the exact command, not by installing behind their back. If that offer is buried, C#
  support reads as absent — the install prompt is part of the feature.
- **The Angular server is tsserver-shaped, not strictly LSP-shaped** (it is built on tsserver and
  deviates in places). Budget for quirks in phase 4 rather than assuming a clean row.
- **Server availability** — most users will not have gopls or clangd. The must-have three plus the
  npm rows have to carry the experience on their own, or the feature reads as broken.
- **A server that hangs** must never hang the daemon: every request gets a timeout, and a server that
  misses its initialize deadline is killed and reported, not awaited.
