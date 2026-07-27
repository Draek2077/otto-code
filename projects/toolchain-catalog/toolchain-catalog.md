# Toolchain catalog — know what the machine can actually do

## The problem

Otto is a coding environment that currently cannot answer "can this machine build a Go project?"
Nothing detects a toolchain, nothing reports one, and nothing tells a user how to get one. The
consequences show up in four separate places:

- **The user** opens a Rust repo and gets no go-to-definition, with no explanation and no next step.
  The feature is not broken; `rust-analyzer` is not installed. Otto cannot tell them apart.
- **The agent** proposes `cargo test` on a machine with no Rust, burns a turn on a `command not
found`, and has to work out from an error string what a capability probe should have told it.
- **The explorer** shows a folder of files rather than a project, because nothing maps `go.mod` or
  `*.csproj` to "this is a project, and here is its shape".
- **The fixtures** ([usage-playbooks](../usage-playbooks/usage-playbooks.md)) already hit this: four
  templates build, and Go, Rust, PHP and Ruby cannot, with the skip logic hand-rolled per template.

The through-line is that **capability is discoverable and Otto never discovers it**.

## What this is

One daemon-side catalog of language toolchains, one detection pass, and one report the whole product
reads from — the Code section, the explorer, the agent's tool descriptions, and the playbooks.

This is an extension of a pattern that already exists rather than a new one.
`packages/server/src/server/lsp/registry.ts` says it outright:

> Which language servers exist, and how to find one on this machine. A language is a row here — not
> code — so adding Go or Rust later is a table entry.

That registry has five rows (typescript, python, csharp, oxlint, angular) and covers exactly one
capability: the language server. A toolchain is larger — a runtime, a package manager, a build
command, a test runner, a formatter, project markers — and everything except the language server is
currently nowhere. **The catalog is `LSP_SERVER_ROWS` widened, and the LSP row becomes one field of a
toolchain row rather than a separate table.**

## Design rules

1. **Detection reports the daemon's view, never the client's.** The daemon may be in WSL, in a
   container, or on another machine entirely while the client is on Windows. A probe run anywhere but
   the daemon answers a question nobody asked. This is the rule most likely to be got wrong, because
   on a single-machine setup the two agree and the bug stays invisible.
2. **A table row, not a code path.** Adding Go is a row. If adding a language requires a branch, the
   catalog shape is wrong.
3. **Never auto-install.** Show the command, let the user run it. Installing a toolchain mutates the
   machine outside the workspace, needs elevation on some platforms, and is not something a coding
   assistant should do while the user's back is turned. Copy-to-clipboard is the feature.
4. **Missing is a state, not an error.** The playbooks already establish this: a missing toolchain
   means the build is _skipped_, and everything not needing it still works. The UI says "not
   installed, here is how", not "failed".
5. **Probe cost is real — cache it.** A spawn per tool per language across thirty languages is
   seconds of process churn. Detect on demand and on an explicit refresh, cache with the resolved
   path's mtime as the key, and never probe on a hot path.
6. **No shell.** Probes are argv arrays. `which` is POSIX-only, `where` is Windows-only, and a shell
   string is a quoting bug per platform. Resolve on PATH directly and spawn the binary.

## The detection ladder

Extends the registry's existing `workspaceBin → bundled → path`, in priority order:

| Rung                | Looks at                                                                                   | Why it ranks here                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `workspaceBin`      | `node_modules/.bin`, `.venv/bin`, `vendor/bin`, `bin/`                                     | A project's own toolchain is the only one whose answers match its build            |
| `versionManager`    | `mise`, `asdf`, `nvm`, `pyenv`, `rbenv`, `rustup`, `sdkman`, `volta`                       | These deliberately shadow PATH; reading PATH alone reports the wrong version       |
| `path`              | `PATH` as the daemon sees it                                                               | The common case                                                                    |
| `platformWellKnown` | Windows registry (.NET, JDK), `/usr/libexec/java_home`, Homebrew prefixes, `Program Files` | Toolchains that install without touching PATH — the .NET SDK and JDKs both do this |
| `bundled`           | Anything Otto ships                                                                        | Last, so a real install always wins                                                |

Each rung yields a path plus a provenance string, and provenance is shown in the UI. "Where did this
`python` come from?" is the question a version-manager user actually has, and answering it is most of
the value.

## Catalog row shape

```jsonc
{
  "id": "go",
  "label": "Go",
  "extensions": [".go"],
  "projectMarkers": ["go.mod", "go.work"],
  "tools": {
    "runtime": {
      "bin": "go",
      "versionArgs": ["version"],
      "versionPattern": "go(\\d+\\.\\d+\\.\\d+)",
    },
    "packageManager": { "bin": "go", "subcommand": ["mod"] },
    "build": { "argv": ["go", "build", "./..."] },
    "test": { "argv": ["go", "test", "./..."] },
    "formatter": { "bin": "gofmt" },
    "languageServer": "gopls", // joins LSP_SERVER_ROWS
  },
  "install": {
    "win32": { "winget": "GoLang.Go" },
    "darwin": { "brew": "go" },
    "linux": { "apt": "golang-go", "dnf": "golang", "note": "distro packages lag; see go.dev/dl" },
  },
}
```

`projectMarkers` is the field that unlocks the explorer: a directory containing `go.mod` is a Go
module, not a folder of files. It is the same question [solution-view](../solution-view/solution-view.md)
is asking for .NET, and the two should share an answer rather than each grow their own.

## Coverage target

Ordered by how likely an Otto user is to open one, not by language popularity in the abstract.

| Tier                            | Languages                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| **1 — have partial support**    | TypeScript/JavaScript, Python, C#                                                   |
| **2 — common, entirely absent** | Go, Rust, Java, Kotlin, Ruby, PHP, C/C++, Swift                                     |
| **3 — worth a row**             | Scala, Elixir, Dart/Flutter, Zig, Lua, Haskell, OCaml, R, Julia, Perl               |
| **4 — markup, data, infra**     | HTML/CSS, SQL, Bash/PowerShell, Terraform, Dockerfile, YAML/TOML, Protobuf, GraphQL |

Tier 4 matters more than its position suggests: a repo is rarely one language, and a Terraform file
with no highlighting in an otherwise well-supported repo reads as a gap in Otto rather than a gap in
the catalog.

## The Code section report

A table: language, detected, version, provenance, what is missing, and the install command. Sorted so
what the open workspace needs is at the top — a Rust repo should surface the missing `rust-analyzer`
without the user going looking.

The same data feeds three other consumers, which is the point of doing it once:

- **The explorer**, via `projectMarkers`, to show projects rather than folders.
- **The agent**, so tool descriptions can say what is actually available and stop proposing `cargo`
  on a machine without it. Cheapest correctness win in the whole charter.
- **The playbooks**, replacing the per-template `probeToolchain` with the shared catalog.

## Install instructions are generated, not written

Users need "how do I install a Go toolchain on my machine", and that is a
[`public-docs/`](../../public-docs/index.md) page — the user-facing manual, not `docs/`, which is for
how Otto is built.

**The page is generated from the catalog.** Roughly forty languages across three platforms is over a
hundred install commands; hand-maintained, that table is stale the week after it is written, and it
would disagree with the in-app report that reads from the catalog — which is worse than having
neither, because the user cannot tell which one to trust. The `install` block already carries per
platform commands for exactly this reason.

Two audiences, one source:

- **In-app**, in the Code section report: only what this machine is missing, with the command for
  _this_ platform, copyable. Contextual and short.
- **In `public-docs/`**, the full table, all platforms, for someone setting up before they install
  Otto or reading on a different machine than the one they are configuring.

Write the page when Phase 1 lands and the catalog exists to generate it from. Writing it earlier means
hand-authoring install commands for languages Otto does not yet support, which is a promise the
product cannot keep.

## Godot

Worth its own section because it is the case that does not fit the shape above, and the misfit is
instructive.

**Why it is a good fit for Otto.** A Godot project is a directory with `project.godot`, plain-text
scene and resource files, and either GDScript or C#. It is the rare game engine whose entire project
format is diffable text — so Changes, blame, file history and review all work on it without anything
new. The C# path is already half-covered by the existing `csharp` row.

**Four things that need building.**

1. **File formats.** `.gd` (GDScript), `.tscn` (scenes), `.tres` (resources), `.gdshader`, plus
   `project.godot` itself. All text, all needing a grammar for highlighting. `.tscn` and `.tres` are
   custom INI-like formats, not YAML or TOML — a near-miss grammar looks worse than none.
2. **The language server does not fit the registry.** Every current row spawns a stdio process.
   Godot's GDScript language server is hosted _inside the running editor_ and speaks LSP over a TCP
   socket. Supporting it means the registry grows a transport field and the pool learns to attach to
   a socket instead of owning a child process. **Unverified — the port and the exact handshake need
   checking against a current Godot build before this is planned in detail.**
3. **Build and export.** Godot has a headless mode intended for CI, which is the hook for building
   and exporting without a GUI. Exact flags need verifying.
4. **Preview.** Godot's web export produces a browser-runnable build — which means Otto's existing
   browser pane could run and verify a game with no new infrastructure, reusing
   [preview](../../docs/preview.md) as-is. Speculative until someone tries it, and the most
   interesting thing in this charter if it holds.

**Recommendation: Godot is a follow-on, not part of the first cut.** It needs a transport the LSP pool
does not have. Land the catalog and the report against languages that fit the existing shape, then
take Godot as the case that justifies extending it.

## Sequence

1. **Catalog + detection + report.** Tier 1 and 2 languages, the detection ladder, the Code-section
   table. Ends with a user being told why go-to-definition is missing and how to fix it.
2. **Wire the existing consumers.** Fold `LSP_SERVER_ROWS` into the catalog; replace the playbooks'
   `probeToolchain`; feed `projectMarkers` to the explorer.
3. **Tier 3 and 4 rows.** Mechanical once the shape holds — the test of whether it does.
4. **Godot**, and the socket transport it forces.

## Open questions

- **Is the catalog data or code?** A JSON file is editable without a release and could be updated
  independently; a TypeScript table gets type checking and cannot drift from the code that reads it.
  The LSP registry chose code. Worth choosing once, deliberately, before there are forty rows.
- **How much does detection cost on a cold machine?** Tier 1–4 is roughly forty languages and well
  over a hundred probes. If a full sweep is seconds, it cannot run at startup and the report needs to
  be explicitly refreshed. Measure before designing the caching.
- **Does the agent get a tool for this, or just better descriptions?** A `check_toolchain` tool is
  precise but costs a round trip; baking availability into descriptions is free but goes stale within
  a session if the user installs something mid-conversation.
