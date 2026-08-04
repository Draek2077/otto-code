# Toolchain catalog - know what the machine can actually do

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
reads from - the Code section, the explorer, the agent's tool descriptions, and the playbooks.

This is an extension of a pattern that already exists rather than a new one.
`packages/server/src/server/lsp/registry.ts` says it outright:

> Which language servers exist, and how to find one on this machine. A language is a row here - not
> code - so adding Go or Rust later is a table entry.

That registry has five rows (typescript, python, csharp, oxlint, angular) and covers exactly one
capability: the language server. A toolchain is larger - a runtime, a package manager, a build
command, a test runner, a formatter, project markers - and everything except the language server is
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
5. **Probe cost is real - cache it.** A spawn per tool per language across thirty languages is
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
| `platformWellKnown` | Windows registry (.NET, JDK), `/usr/libexec/java_home`, Homebrew prefixes, `Program Files` | Toolchains that install without touching PATH - the .NET SDK and JDKs both do this |
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
| **1 - have partial support**    | TypeScript/JavaScript, Python, C#                                                   |
| **2 - common, entirely absent** | Go, Rust, Java, Kotlin, Ruby, PHP, C/C++, Swift                                     |
| **3 - worth a row**             | Scala, Elixir, Dart/Flutter, Zig, Lua, Haskell, OCaml, R, Julia, Perl               |
| **4 - markup, data, infra**     | HTML/CSS, SQL, Bash/PowerShell, Terraform, Dockerfile, YAML/TOML, Protobuf, GraphQL |

Tier 4 matters more than its position suggests: a repo is rarely one language, and a Terraform file
with no highlighting in an otherwise well-supported repo reads as a gap in Otto rather than a gap in
the catalog.

## The catalog, in full

Four columns of the eventual row, for every language above. This is the working list Phase 1 and 3
build from, not a wish list - each row names the binary detection probes for, the project marker the
explorer keys on, the file extensions that need a grammar, and the language server.

**Tier 1 - partial support today.** The language-server column is the only part that exists.

| Language              | Extensions                              | Project marker                  | Toolchain bins                          | Language server                 |
| --------------------- | --------------------------------------- | ------------------------------- | --------------------------------------- | ------------------------------- |
| TypeScript/JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | `package.json`, `tsconfig.json` | `node` `npm` `pnpm` `yarn` `bun` `deno` | `typescript-language-server` ✅ |
| Python                | `.py .pyi`                              | `pyproject.toml`, `setup.py`    | `python` `pip` `uv` `poetry`            | `pyright-langserver` ✅         |
| C#                    | `.cs .csx`                              | `*.csproj`, `*.sln`, `*.slnx`   | `dotnet`                                | `csharp-ls` ✅                  |

**Tier 2 - common, entirely absent.**

| Language | Extensions                | Project marker                   | Toolchain bins                            | Language server              |
| -------- | ------------------------- | -------------------------------- | ----------------------------------------- | ---------------------------- |
| Go       | `.go`                     | `go.mod`, `go.work`              | `go` `gofmt`                              | `gopls`                      |
| Rust     | `.rs`                     | `Cargo.toml`                     | `cargo` `rustc` `rustfmt`                 | `rust-analyzer`              |
| Java     | `.java`                   | `pom.xml`, `build.gradle{,.kts}` | `java` `javac` `mvn` `gradle`             | `jdtls`                      |
| Kotlin   | `.kt .kts`                | `build.gradle.kts`               | `kotlinc` `gradle`                        | `kotlin-language-server`     |
| Ruby     | `.rb .erb .rake`          | `Gemfile`, `*.gemspec`           | `ruby` `gem` `bundle`                     | `ruby-lsp`                   |
| PHP      | `.php`                    | `composer.json`                  | `php` `composer`                          | `phpactor` or `intelephense` |
| C/C++    | `.c .h .cpp .cc .hpp .hh` | `CMakeLists.txt`, `Makefile`     | `cc` `g++` `clang` `cmake` `make` `ninja` | `clangd`                     |
| Swift    | `.swift`                  | `Package.swift`, `*.xcodeproj`   | `swift` `swiftc`                          | `sourcekit-lsp`              |

**Tier 3 - worth a row.**

| Language     | Extensions       | Project marker              | Toolchain bins        | Language server           |
| ------------ | ---------------- | --------------------------- | --------------------- | ------------------------- |
| Scala        | `.scala .sc`     | `build.sbt`, `build.mill`   | `scala` `sbt` `mill`  | `metals`                  |
| Elixir       | `.ex .exs .heex` | `mix.exs`                   | `elixir` `mix`        | `elixir-ls` or `expert`   |
| Dart/Flutter | `.dart`          | `pubspec.yaml`              | `dart` `flutter`      | `dart language-server`    |
| Zig          | `.zig .zon`      | `build.zig`                 | `zig`                 | `zls`                     |
| Lua          | `.lua`           | `.luarc.json`, `*.rockspec` | `lua` `luarocks`      | `lua-language-server`     |
| Haskell      | `.hs .lhs`       | `*.cabal`, `stack.yaml`     | `ghc` `cabal` `stack` | `haskell-language-server` |
| OCaml        | `.ml .mli`       | `dune-project`              | `ocaml` `dune` `opam` | `ocamllsp`                |
| R            | `.R .r .Rmd`     | `DESCRIPTION`, `*.Rproj`    | `R` `Rscript`         | `languageserver` (R pkg)  |
| Julia        | `.jl`            | `Project.toml`              | `julia`               | `LanguageServer.jl`       |
| Perl         | `.pl .pm .t`     | `Makefile.PL`, `cpanfile`   | `perl` `cpanm`        | `Perl::LanguageServer`    |

**Tier 4 - markup, data, infra.** Mostly grammar-and-formatter rows; several have no project marker
because they are never the project, only files inside one.

| Language       | Extensions                      | Project marker | Toolchain bins           | Language server                   |
| -------------- | ------------------------------- | -------------- | ------------------------ | --------------------------------- |
| HTML/CSS       | `.html .htm .css .scss .less`   | -              | `sass`                   | `vscode-html/css-language-server` |
| SQL            | `.sql`                          | -              | `psql` `sqlite3` `mysql` | `sqls`                            |
| Bash           | `.sh .bash`                     | -              | `bash` `shellcheck`      | `bash-language-server`            |
| PowerShell     | `.ps1 .psm1 .psd1`              | `*.psd1`       | `pwsh`                   | PowerShell Editor Services        |
| Terraform      | `.tf .tfvars`                   | `*.tf`         | `terraform` `tofu`       | `terraform-ls`                    |
| Docker         | `Dockerfile`, `compose.yaml`    | `Dockerfile`   | `docker`                 | `docker-langserver`               |
| YAML/TOML/JSON | `.yaml .yml .toml .json .jsonc` | -              | -                        | `yaml-language-server`, `taplo`   |
| Protobuf       | `.proto`                        | `buf.yaml`     | `protoc` `buf`           | `buf beta lsp`                    |
| GraphQL        | `.graphql .gql`                 | `.graphqlrc*`  | -                        | `graphql-lsp`                     |
| Markdown       | `.md .mdx`                      | -              | -                        | `marksman`                        |

**Server names are unverified as install targets.** They are the right servers; whether each is
`npm i -g`, a distro package, a language-native install (`go install`, `gem install`, `dotnet tool`),
or a GitHub release binary has to be checked per row when that row is built. Several are known
awkward - `jdtls` wants a JDK and a launcher script, R's `languageserver` is an R package installed
from within R, and `Perl::LanguageServer` is CPAN.

## Install routes, and the ones that do not exist

Verified against `winget` on the dev machine, 2026-07-26. **`winget show --id <id> --exact` is the
check** - a package that resolves is real, and eight of the ones you would expect are not.

| Toolchain   | Windows (`winget`)                        | macOS (`brew`)    | Linux                       |
| ----------- | ----------------------------------------- | ----------------- | --------------------------- |
| Go          | `GoLang.Go` ✅                            | `go`              | `golang-go` / `golang`      |
| Rust        | `Rustlang.Rustup` ✅                      | `rustup`          | `rustup` via rustup.rs      |
| Node        | `OpenJS.NodeJS.LTS` ✅                    | `node`            | `nodejs`                    |
| Python      | `Python.Python.3.13` ✅                   | `python@3.13`     | `python3`                   |
| .NET        | `Microsoft.DotNet.SDK.9` ✅               | `dotnet-sdk`      | `dotnet-sdk-9.0`            |
| Java        | `EclipseAdoptium.Temurin.21.JDK` ✅       | `temurin`         | `temurin-21-jdk`            |
| PHP         | `PHP.PHP.8.4` ✅                          | `php`             | `php-cli`                   |
| Ruby        | `RubyInstallerTeam.RubyWithDevKit.3.4` ✅ | `ruby`            | `ruby-full`                 |
| C/C++       | `LLVM.LLVM` ✅                            | `llvm`            | `clang` / `build-essential` |
| Swift       | `Swift.Toolchain` ✅                      | Xcode CLT         | swift.org tarball           |
| Zig         | `zig.zig` ✅ (lowercase)                  | `zig`             | `zig`                       |
| Julia       | `Julialang.Juliaup` ✅                    | `juliaup`         | `juliaup`                   |
| Lua         | `DEVCOM.Lua` ✅                           | `lua`             | `lua5.4`                    |
| Perl        | `StrawberryPerl.StrawberryPerl` ✅        | system perl       | `perl`                      |
| CMake       | `Kitware.CMake` ✅                        | `cmake`           | `cmake`                     |
| Ninja       | `Ninja-build.Ninja` ✅                    | `ninja`           | `ninja-build`               |
| Make        | `GnuWin32.Make` ✅                        | system make       | `make`                      |
| Terraform   | `Hashicorp.Terraform` ✅                  | `terraform`       | HashiCorp apt repo          |
| Docker      | `Docker.DockerDesktop` ✅                 | `--cask docker`   | `docker.io`                 |
| Protobuf    | `Google.Protobuf` ✅                      | `protobuf`        | `protobuf-compiler`         |
| Bun         | `Oven-sh.Bun` ✅                          | `oven-sh/bun/bun` | bun.sh installer            |
| Godot       | `GodotEngine.GodotEngine` ✅ / `.Mono` ✅ | `godot`           | Official download / Flathub |
| **Kotlin**  | ❌ none - SDKMAN, or via Gradle           | `kotlin`          | SDKMAN                      |
| **Scala**   | ❌ none - Coursier (`cs setup`)           | `coursier`        | Coursier                    |
| **Flutter** | ❌ none - official installer/git clone    | `--cask flutter`  | Official tarball / snap     |
| **Elixir**  | ❌ none - official installer              | `elixir`          | `elixir`                    |
| **Deno**    | ❌ none - deno.land installer             | `deno`            | deno.land installer         |
| **Haskell** | ❌ none - GHCup installer                 | `ghcup`           | GHCup                       |
| **OCaml**   | ❌ none - Diskuv / WSL                    | `opam`            | `opam`                      |
| **R**       | ❌ none under that id - CRAN installer    | `r`               | `r-base`                    |

**This is the finding that shapes the schema.** A third of these have no Windows package manager
entry, so the `install` block cannot be a map of package IDs. It needs a discriminated shape:

```jsonc
"install": {
  "win32": { "kind": "winget", "id": "GoLang.Go" },
  "darwin": { "kind": "brew", "formula": "go" },
  "linux": { "kind": "apt", "package": "golang-go", "note": "distro lags; see go.dev/dl" }
}
// …or, where no package exists:
"win32": { "kind": "manual", "url": "https://kotlinlang.org/docs/command-line.html",
           "note": "SDKMAN, or let Gradle provision the compiler" }
```

A `manual` route is a first-class outcome, not a gap to apologise for. The honest version - "there is
no winget package; here is the official installer" - is more useful than a command that fails.

Godot's two winget entries confirm a point in the
[Godot charter](../godot-integration/godot-integration.md): the standard and .NET builds are separate
downloads, and the standard one cannot run a C# project at all. Detection has to tell them apart.

**Version managers are the better answer where they exist**, and the detection ladder already ranks
them above PATH. `mise` and `asdf` cover most of tiers 2 and 3 in one tool. Where a language's own
version manager is the community norm - `rustup`, `juliaup`, `ghcup`, `sdkman`, `nvm`, `pyenv` - the
row should recommend that over the system package, because the system package is what gets stale and
then disagrees with the project's expectations.

## The status page

Lives in the Code section. **Everything on it describes the daemon's machine, and the page says so
out loud** - a header line naming the host, because a user on Windows reading a page about their WSL
daemon will otherwise misread every row on it.

A row per language, [a table not a card](../../docs/design.md):

| Column       | Holds                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Language     | Name, plus a badge when the open workspace uses it                                |
| Status       | Ready · Partial · Not installed                                                   |
| Version      | Parsed from the probe, blank when absent                                          |
| From         | Provenance - `PATH`, `mise 2026.1`, `.venv`, `Program Files`, `node_modules/.bin` |
| Capabilities | Which of build / test / format / language server resolved                         |
| Action       | The install command for this platform, copyable - or an official-installer link   |

**Partial is the state that earns the page.** A machine with `go` but no `gopls` builds fine and has
no go-to-definition, and today Otto presents that as a feature silently not working. One row saying
`Go · Partial · go 1.25 from PATH · build ✓ test ✓ format ✓ LSP ✗ · go install …@latest` replaces an
hour of confusion.

Sorted so the open workspace's languages come first - a Rust repo should surface a missing
`rust-analyzer` without anyone going looking. Everything else collapses behind a "show all languages"
disclosure, because forty rows is a wall.

Refresh is explicit, with a timestamp. Detection spawns processes, and a page that re-probes on every
render is a page that spawns a hundred processes on every render.

### What it must not do

- **Never auto-install.** Show and copy the command. Installing a toolchain mutates the machine
  outside the workspace and often needs elevation.
- **Never say "failed".** A missing toolchain is _not installed_, which is a normal state on a normal
  machine. Red is for a probe that errored - a binary on PATH that will not execute, a version string
  that would not parse - because that is a real fault and looks nothing like an absent install.
- **Never report the client's machine.** See above; this is the bug that hides on a single-host setup.

The same data feeds three other consumers, which is the point of doing it once:

- **The explorer**, via `projectMarkers`, to show projects rather than folders.
- **The agent**, so tool descriptions can say what is actually available and stop proposing `cargo`
  on a machine without it. Cheapest correctness win in the whole charter.
- **The playbooks**, replacing the per-template `probeToolchain` with the shared catalog.

## Install instructions are generated, not written

Users need "how do I install a Go toolchain on my machine", and that is a
[`public-docs/`](../../public-docs/index.md) page - the user-facing manual, not `docs/`, which is for
how Otto is built.

**The page is generated from the catalog.** Roughly forty languages across three platforms is over a
hundred install commands; hand-maintained, that table is stale the week after it is written, and it
would disagree with the in-app report that reads from the catalog - which is worse than having
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

The page owes the reader four things per language, all of which the catalog already holds: the
command for their platform, an honest `manual` route where no package manager carries it, which
version manager the community actually uses, and the fact that a **language server is a separate
install from the toolchain**. That last one is the single most common confusion this page can head
off - `winget install GoLang.Go` gets you a Go that builds and no go-to-definition, because `gopls`
is a second command.

## Godot

Worth its own section because it is the case that does not fit the shape above, and the misfit is
instructive.

**Why it is a good fit for Otto.** A Godot project is a directory with `project.godot`, plain-text
scene and resource files, and either GDScript or C#. It is the rare game engine whose entire project
format is diffable text - so Changes, blame, file history and review all work on it without anything
new. The C# path is already half-covered by the existing `csharp` row.

**Four things that need building.**

1. **File formats.** `.gd` (GDScript), `.tscn` (scenes), `.tres` (resources), `.gdshader`, plus
   `project.godot` itself. All text, all needing a grammar for highlighting. `.tscn` and `.tres` are
   custom INI-like formats, not YAML or TOML - a near-miss grammar looks worse than none.
2. **The language server does not fit the registry.** Every current row spawns a stdio process.
   Godot's GDScript language server is hosted _inside the running editor_ and speaks LSP over a TCP
   socket. Supporting it means the registry grows a transport field and the pool learns to attach to
   a socket instead of owning a child process. **Unverified - the port and the exact handshake need
   checking against a current Godot build before this is planned in detail.**
3. **Build and export.** Godot has a headless mode intended for CI, which is the hook for building
   and exporting without a GUI. Exact flags need verifying.
4. **Preview.** Godot's web export produces a browser-runnable build - which means Otto's existing
   browser pane could run and verify a game with no new infrastructure, reusing
   [preview](../../docs/preview.md) as-is. Speculative until someone tries it, and the most
   interesting thing in this charter if it holds.

**Recommendation: Godot is a follow-on, not part of the first cut.** It needs a transport the LSP pool
does not have. Land the catalog and the report against languages that fit the existing shape, then
take Godot as the case that justifies extending it.

## Sequence

1. **Catalog + detection + status page.** Tier 1 and 2 languages, the detection ladder, the
   Code-section table. Ends with a user being told why go-to-definition is missing and how to fix it.
2. **Wire the existing consumers.** Fold `LSP_SERVER_ROWS` into the catalog; replace the playbooks'
   `probeToolchain`; feed `projectMarkers` to the explorer. Generate the `public-docs/` install page.
3. **Tier 3 and 4 rows.** Mechanical once the shape holds - the test of whether it does.
4. **Language servers and grammars for tier 2**, so "supported" means editing works, not just that
   detection knows the language exists.
5. **Godot**, and the socket transport it forces. Charter:
   [godot-integration](../godot-integration/godot-integration.md).

Steps 1 and 2 are the ones that change a user's day. Step 4 is the largest and should not start until
the catalog shape has survived step 3.

## What "supported" has to mean

A language is not supported because it has a catalog row. The bar is four things, and a row that has
only some of them should say so on the status page rather than claim the language:

1. **File formats** - every extension in the row highlights, and the rendered previews work for the
   ones that have a rendered form.
2. **Editing** - indentation, comment toggling and bracket matching behave like the language, not
   like C.
3. **Language services** - go-to-definition, hover, references, rename and diagnostics, via the
   language server. See [docs/code-intelligence.md](../../docs/code-intelligence.md).
4. **Project support** - the explorer shows a project via `projectMarkers`, and build/test/format
   resolve to real commands.

Detection is what makes it honest: with the catalog in place, Otto can tell a user _which_ of those
four it has for a given language on their machine, instead of the current situation where every gap
looks the same from the outside.

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
