# LSP code intelligence

**Status:** Charter (2026-07-24). Nothing built. Supersedes the ctags-based half of
[docs/text-editor.md](../../docs/text-editor.md)'s "Go to definition" section.

Replace name-based go-to-definition with a real Language Server Protocol client in the daemon, and
open the door to hover, find-references, rename, and diagnostics behind the same machinery.

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
wrong answer. Otto already mirrors the buffer to the daemon (`onDocSync`, debounced 750ms, built for
crash recovery). That mirror becomes the document-sync feed: tab open → `textDocument/didOpen` with
the draft, doc sync → `didChange` (full-text sync is fine for v1), tab close → `didClose`. This is
the piece that makes the feature _correct_ rather than _approximately correct_.

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
   idle timer (default ~2 min) instead of the normal long one (~15 min). Switch away, get the memory
   back; switch back, pay a warm-up you asked for by switching.
3. **A hard global cap.** "Max running language servers" (default 4), LRU-evicted. This is the
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

| Must          | Server                               | Launch                                                                 | Acquisition                                                                                                 |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TS/JS/TSX/JSX | `typescript-language-server --stdio` | resolve the workspace's own TypeScript so the answer matches its build | workspace `node_modules/.bin` → our dep → PATH                                                              |
| Python        | `pyright-langserver --stdio`         | plain                                                                  | our dep → PATH                                                                                              |
| C#            | `roslyn-language-server --stdio`     | plain stdio                                                            | `dotnet tool install -g roslyn-language-server` (or Mason), then PATH — **user-consented, never automatic** |

C# was originally deferred here on the assumption it needed a bespoke bootstrap. That was wrong, and
the correction matters: use the **`roslyn-language-server` wrapper**, not raw
`Microsoft.CodeAnalysis.LanguageServer`. The wrapper exists precisely to take the solution/project
preloading and hand back an ordinary stdio LSP endpoint, which is how Neovim and Helix consume
Roslyn. It is a **dotnet global tool**, so acquisition is one explicit command and discovery is just
PATH, and the .NET SDK it needs is something every C# developer has by definition. Newer builds
(≥ 5.8.0-1.26262.10) also cover Razor/`.cshtml`.

> **Open question for Phase 1, not for the charter:** whether the wrapper fully absorbs the
> solution/project-open handshake, or whether we must still send `solution/open` after `initialize`.
> The public docs don't say. Verify against both a `.sln` repo and a loose-folder repo before
> designing around either answer — it decides whether C# needs a per-language bootstrap hook.

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
  workspace archive and daemon shutdown, restarted with capped backoff on crash.
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
   Angular is deliberately its own phase: it is the one that proves the architecture, not a config
   line.
5. **The payoff** — hover, find-references, rename, diagnostics. Each its own increment on machinery
   that already exists. This is where the cost of phases 1–2 is repaid.

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
