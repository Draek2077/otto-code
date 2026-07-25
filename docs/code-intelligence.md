# Code intelligence (LSP)

Go-to-definition, hover, find-references, rename and diagnostics resolve through a **real language
server** running in the daemon. The ctags name index (`server/file-explorer/code-index.ts`) remains
as the designed no-server fallback — it still owns the outline and the fuzzy finder — but it is no
longer what answers a definition.

Editor surfaces and the file tab itself: [text-editor.md](text-editor.md). Protocol naming:
[rpc-namespacing.md](rpc-namespacing.md).

## Why a server rather than an index

A name index answers "every symbol anywhere called `foo`". A language server answers "the definition
of _this_ identifier at _this_ position". The difference is not accuracy polish — it is the
difference between a picker of coincidences and a resolved reference.

The cost is inverted, and being honest about that is part of the feature:

|             | ctags index               | language server         |
| ----------- | ------------------------- | ----------------------- |
| when        | every lookup              | once per session        |
| where       | foreground, on your click | background, after spawn |
| after that  | the same cost again       | ~10 ms, forever         |
| correctness | name match                | resolved reference      |

## Layout

`packages/server/src/server/lsp/`:

| File            | What it owns                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `uri.ts`        | `file://` ↔ path over Node's WHATWG conversion, plus `documentKey` — the canonical identity that keeps `c:` and `C:` one file |
| `connection.ts` | One live server: spawn, `vscode-jsonrpc` stdio channel, handshake, per-request timeouts, exit reporting                       |
| `registry.ts`   | The language rows and the workspace-first discovery ladder                                                                    |
| `pool.ts`       | Running servers keyed by (workspace × server): lazy spawn, idle reap, LRU cap, capped-backoff restart, document binding       |
| `documents.ts`  | The document mirror — didOpen/didChange/didClose, per-document versions, fan-out to every bound server                        |
| `service.ts`    | Query fan-out, merge/dedupe by (path, line, column), the three-valued status                                                  |

RPCs live in `workspace-files-session.ts` beside the ctags `code.symbols` handler, behind the same
workspace guard. Capability flag: `server_info.features.lsp`. The feature contract applies — **no
fallback path**; an old daemon shows "Update the host to use this."

## Invariants

These are the ones that cost something to rediscover.

- **A query must not depend on another tab being open.** A server that never received `didOpen` for a
  document answers **empty, not an error** — so a missing mirror entry looks exactly like "no
  definition here". `capableServersFor` syncs the document before querying. This is the single
  sharpest gotcha in the subsystem.
- **The wire is 1-based; LSP is 0-based.** Positions on `code.definition` match `CodeSymbolLocation`
  and the rest of Otto. `service.ts` is the only place that converts.
- **Identity is `documentKey`, never a raw URI.** Node's stdlib round-trips drive letters, UNC,
  `\\wsl$\`, spaces, unicode and `#` correctly, so there is no `vscode-uri` dependency — but a server
  may echo a document back in an equivalent-but-different spelling, so every map keys on
  `documentKey`.
- **A lazily-spawned server gets `didOpen` with current text, never a replayed `didChange`.** Servers
  start on the first query, long after the edits. The per-document record tracks _which connection_
  holds it open, so a crashed-and-restarted server is re-opened rather than sent changes against a
  baseline it never saw.
- **Fan-out filters on advertised capability, not on a registry column.** `capableServersFor` reads
  `definitionProvider` / `hoverProvider` / `referencesProvider` / `renameProvider` from the server's
  own `initialize` reply. A `provides:` column in the registry would be ours to keep accurate
  forever.
- **One server answering is success, not a race.** Results merge and dedupe by (path, line, column).
  The "every bound server failed" branch must not fire when one capable server answered fine.
- **`ok` with zero locations is authoritative.** The client falls through to ctags only on
  `unavailable` (no server for this language on this host) — never on an empty `ok`.
- **Resolution order is workspace-first, always.** The workspace's own `node_modules/.bin` before our
  bundled copy before PATH. A server that type-checks the project must be the version the project
  installs.
- **Indexing is a real signal, not a timer.** `LspConnection.isIndexing` counts in-flight `$/progress`
  begin/end pairs. An empty result while indexing reports `indexing`; otherwise `ok`.
- **`window.workDoneProgress` must be _advertised_ in client capabilities.** The spec forbids a server
  sending `$/progress` unless the client asked for it — answering the request is not enough. This
  was the root cause of a blocking rename defect, misdiagnosed as a tsserver limitation.
- **`z.object`, not `looseObject`, for LSP reply parsing.** A loose object's index signature collapses
  the `Location | LocationLink` union to `unknown`. Prefer `targetSelectionRange` so the caret lands
  on the identifier rather than the doc comment above it.
- **`shell: true` is the wrong way to run a `.cmd` shim** — it concatenates argv unescaped, so a
  workspace under `C:\My Projects\` splits into garbage. `planLanguageServerSpawn` invokes ComSpec
  with `/d /s /c` and explicit quoting.
- **The pool holds no timers**, by design — every decision reads an injected clock, which is what
  makes idle/backoff testable without wall time. See the lifecycle warning below for the other half
  of that bargain.

## Lifecycle: the obligation the pool moves outward

The pool's cost controls (`reapIdle`, `setActiveWorkspace`, `stopWorkspace`, `stopAll`) are written
to be _called from outside_. For several phases they had **zero production call sites** — every unit
test still passed while idle exit, background reap and archive teardown described tests rather than
the daemon. Only the LRU cap actually bounded the process count, and that is a backstop, not a
policy.

Name the failure mode, because it is not a bug in any one file: "the pool holds no timers" is a
correct testability decision that **moves an obligation out of the subsystem**, and nothing inside
the subsystem can fail when the obligation goes unpaid.

| Obligation                    | Who pays it                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The idle tick                 | `websocket-server.ts` — `startLspIdleReapInterval`, every 30 s, `unref`'d, cleared in `close()`                             |
| Which workspace is "active"   | `LspService.setActiveWorkspace`, from its own request path (`syncDocument` + `capableServersFor`)                           |
| Teardown on workspace archive | `archiveByScope` via the `stopLanguageServers` dependency, gated on the same last-reference rule the directory removal uses |
| Teardown on daemon shutdown   | `websocket-server.close()` → `lspService.stopAll()`                                                                         |

- **The active workspace is derived, not pushed.** There is no focus signal on the wire and adding one
  would give the idle policy a second source of truth — the stale one leaves servers running. Every
  code-intelligence request already _is_ a focus signal: hover, definition and buffer sync only
  happen for the file someone is looking at.
- **Archive teardown is keyed by directory, not by workspace record**, because that is how a server is
  keyed. Two workspace records over one `cwd` mean archiving the first must not stop the servers the
  second still uses — the same `isDirectoryUnreferenced` predicate that decides whether the worktree
  directory may be removed.
- **No teardown may fail an archive.** The archive has already happened; a server that refuses to die
  is logged and left to the reaper.

Regression guard: `websocket-server.lsp-lifecycle.test.ts` — that the daemon ticks and that shutdown
stops everything. Not what the pool does with the tick; `pool.test.ts` owns that.

## The indexing-cost policy

What people object to is _invisible, always-on, unbounded_ indexing, so the policy is part of the
feature:

- **Lazy spawn.** No server starts until a code-intelligence action needs that language in that
  workspace. Never open Rust, never pay for rust-analyzer.
- **Per-language opt-in**, with the cost stated next to each toggle.
- **Idle shutdown.** An unused server exits after N minutes; memory comes back.
- **Visible.** "Indexing TypeScript (first run)…" with elapsed time — never a spinner that reads as
  hung.
- **A zero-index tier.** The ctags index stays and is the honest answer for anyone who wants no
  servers at all.

Per-server reality, so settings copy can be honest:

| Server                                | Index cost                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| JSON / CSS / HTML / Bash              | **none** — per-document, no project model                                       |
| pyright, gopls                        | seconds                                                                         |
| typescript-language-server (tsserver) | seconds to ~30 s cold on a repo this size; 1–4 GB resident                      |
| clangd                                | background **on-disk** index; needs `compile_commands.json` to be useful at all |
| rust-analyzer                         | the expensive one — minutes cold, re-runs on dependency changes                 |

## Languages

A language is a **registry row** — id, extensions, command, discovery ladder, init options — not
code. The count is cheap; reachability on the user's machine is what varies.

TypeScript/JavaScript, Python and C# are not "tier one", they are the **acceptance criteria**.

| Language      | Server                                                     | Launch                                                                 | Acquisition                                                                         |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TS/JS/TSX/JSX | `typescript-language-server --stdio`                       | resolve the workspace's own TypeScript so the answer matches its build | workspace `node_modules/.bin` → our dep → PATH                                      |
| Python        | `pyright-langserver --stdio`                               | plain                                                                  | our dep → PATH                                                                      |
| C#            | `csharp-ls` (stdio is its default — **no** `--stdio` flag) | plain stdio                                                            | `dotnet tool install -g csharp-ls`, then PATH — **user-consented, never automatic** |

Empirically settled, and worth not re-deriving:

- **`typescript-language-server` 5.3 sends no `serverInfo`** — only `capabilities`. It is optional in
  LSP; do not assert on it. `csharp-ls` **does** send it.
- **There is no `roslyn-language-server` to install.** Not on nuget.org, not on npm, and
  `dotnet tool install -g roslyn-language-server` **exits 0 while failing** — a naive install step
  would report success. Editors that consume Roslyn directly unpack the nupkg themselves; that is a
  bootstrap we are not writing. `csharp-ls` is the row that works.
- **C# needs no per-language hook.** It initializes as an ordinary stdio server against a loose
  folder, a classic `.sln`, and .NET 10's `.slnx`, finding the project itself.
- **.NET 10's `dotnet new sln` emits `.slnx`, not `.sln`.** Anything detecting "is this a solution
  repo" must match both.

### Linters are language servers too

`oxlint --lsp` is a real LSP server and ships as a row with discovery **`workspaceBin` only**. That
is not a packaging accident: a linter's rules are the project's own opinion, so falling back to our
bundled copy would fill a repo's gutter with rules its authors never chose. A repo without oxlint
honestly gets no lint diagnostics.

**This row is what forced capability-based fan-out, and it is the better design** — oxlint binds
`.ts` beside the TypeScript server but answers only diagnostics. It is also the first production user
of multi-server binding.

**ESLint is not shipped, and shipping it blind would be worse than the gap.** `vscode-eslint`'s server
requests real settings through `workspace/configuration`, and this client answers `{}` for every
item — enough for pyright, almost certainly not for ESLint, which would then validate nothing and
read as a broken row rather than an absent one. It needs the same empirical probe `csharp-ls` got.
`tslint` is not a candidate: deprecated in 2019, folded into `typescript-eslint`.

**Never download a binary silently.** npm servers ship as optional dependencies; everything else is
discovered, and when missing the answer is an offer (with the exact command shown) or a plain "no
language server for Go" — never an error, never a background download.

The editor's ~20 Lezer grammars (`packages/highlight/src/parsers.ts`) are independent: a language can
have a server without a grammar and vice versa.

## Settings — Daemon → Code

`MutableDaemonConfig.lsp` (master switch, sparse per-language map, limits) plus `lsp.servers.list` /
`lsp.server.stop` for live state, rendered by `screens/settings/code-intelligence-section.tsx`.

- **Config and live state are separate RPCs on purpose.** Which languages are enabled is
  configuration; which servers this host can supply and which are running is not.
- **`languages` is sparse, and an absent key means "use the row's default"** — so a row added later
  ships with its intended default instead of reading as disabled by an older config file.
- **`defaultEnabled` lives on the registry row, not in the config.** TypeScript, Python and C# ship
  **on** — a language that must be switched on before it works has not shipped. Anything with a heavy
  index (rust-analyzer, clangd) ships off.
- **The master switch defaults on, and that is safe** because spawning is lazy. What the switch
  guarantees is that off means off _now_ — `applySettings` stops what is running rather than waiting
  for an idle timeout, or the switch is decoration.
- **Availability is scoped to a workspace**, because it genuinely varies by one: a server can sit in
  one project's `node_modules` and be absent from another's. With no workspace open the screen says
  so instead of guessing.
- The running-servers table is a real table (server / workspace / uptime / Stop), per the repo's
  "data needs a table, not a card" rule.

## Rename is a reversible job

Rename does not apply edits from the client. `code.rename.plan` returns a **planId** and a preview of
the affected files; `code.rename.apply` carries **the planId, not the edits**. The daemon owns the
plan, so the client cannot smuggle a mutated edit set past the preview the user approved. It surfaces
as its own job tab, like Refine.

## Deferred

- **Angular / multi-server-per-document framework rows.** Deferred indefinitely — the multi-server
  binding it existed to prove now has a real production user in the `oxlint` row.
- **The ctags fallback's incremental re-index.** It should build once and re-index only the written
  file (the write path already knows the path) instead of invalidating the workspace. That alone
  removes the latency complaint for the no-server case.
