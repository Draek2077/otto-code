# The Solution view

A second lens on the Files module: the tree as **the build system** sees it, rather than as the
filesystem lays it out. .NET (`.sln` / `.slnx` / `.csproj`) is the first implementation; the seam it
plugs into is language-neutral by construction.

For a .NET developer the daily value is seeing the code organised the way the build organises it -
projects in solution-folder order, test projects beside their subjects, `bin`/`obj` simply gone, and
files that are actually compiled distinguished from files that merely sit on disk. That last point
is the one a filesystem tree structurally cannot show.

**The view is transparent.** A workspace with no solution never sees the switcher, never pays a
probe cost, and behaves exactly as it did before this shipped.

## "Solution", never "Project"

**Project is a taken Otto noun** - a logical grouping of workspaces sharing a git remote
([glossary.md](glossary.md)). A .NET project is a completely different thing, and the two appear on
screen at the same time (Otto's project sidebar, and a `.csproj` node in the tree). So:

- The view mode is **Solution** (vs. **Files**). Never "Project view".
- `.csproj` nodes are labelled with their own name and typed `solutionProject` in code - never a
  bare `project`.

This is the same discipline that keeps **Chat** and **Agent** apart.

## The correction this subsystem exists because of

**The Language Server Protocol gives us no project structure at all.** Not something Otto has yet to
wire - something that does not exist. There is no "describe this solution's projects and their file
membership" request in the protocol. `csharp-ls` understands a solution **privately**; it never tells
us what it found.

So the Solution view builds its own model, and is **independent of the LSP subsystem** in every way
that matters: its own daemon package, its own settings row, its own capability flag. Turning C# code
intelligence off does not turn this off, and vice versa.

## The switch - "Microsoft .NET Solution Management"

A single enable/disable setting under **Daemon → Code**, a **separate row** from Code Intelligence.
Setting id `dotnetSolutionManagement`, a sibling of `lsp` rather than a member of it - putting it
inside the LSP settings object would imply exactly the coupling the section above rejects.

**Default: off.** The feature spawns a process and evaluates MSBuild; that is opted into.

**Disabled is genuinely off, not merely hidden.** No discovery walk, no `.sln`/`.slnx` read, no
`.csproj` parse, no sidecar process, no cache, no watcher - and no view switcher. The check lives at
one method boundary, `SolutionService`'s public surface, so a disabled feature costs exactly one
boolean. Anything that moved that check downstream would make the guarantee a matter of every
caller's discipline rather than of the design; `service.test.ts` asserts it against a provider spy
that records every call it never receives.

## Architecture

Otto already spawns language-specific helper processes and talks to them over stdio - that is what
`lsp/pool.ts` does with `csharp-ls`. The Solution view does the same thing with a .NET sidecar,
because Microsoft has open-sourced the exact libraries for this domain and reimplementing them is
the class of mistake the whole design avoids.

```
packages/dotnet-probe/                       the sidecar (C#) - README there
packages/server/src/server/solution-model/
  provider.ts          SolutionProvider - the language-neutral seam
  paths.ts             the one boundary between "somewhere on disk" and "openable by the client"
  cache.ts             per-solution model + the read-side freshness stamp
  service.ts           RPC façade; the switch; project files → a directory tree
  dotnet/discover.ts   the bounded directory walk (Node - see below)
  dotnet/bootstrap.ts  locate the SDK and the payload; report absence
  dotnet/probe.ts      one sidecar process: spawn, handshake, NDJSON, timeouts
  dotnet/pool.ts       lifecycle keyed by (workspace × solution)
  dotnet/provider.ts   DotnetSolutionProvider - implementation #1
packages/app/src/solution/                   the lens, its queries, and its row builder
```

### The libraries, and why not the alternatives

| Library                                        | What it owns for us                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Microsoft.VisualStudio.SolutionPersistence** | `.sln` **and** `.slnx`; solution folders and their nesting; configurations and platforms; project type GUIDs |
| **Microsoft.Build** (evaluation only)          | Evaluated item membership with the SDK's default globs expanded, project/package references, multi-targeting |

The decisive property of SolutionPersistence is that it is _the same parser the toolchain uses_ -
MSBuild, the .NET CLI and Visual Studio all read solutions through it - so our tree cannot disagree
with `dotnet build` about what is in the solution.

**Rejected, with reasons:**

- **Hand-parsing plus CLI shelling.** `dotnet sln list` returns a flat list of `.csproj` paths;
  solution folders - the entire organisational payload of this view - are exposed by no CLI surface.
  Recovering them from `GlobalSection(NestedProjects)` GUID tables is exactly the class of mistake to
  avoid. `dotnet msbuild <sln> -getItem:` also fails outright (`MSB1063`), so membership would cost
  one process per project.
- **The npm parsers** (`vs-parse`, `visualstudiofiles`, `node-csproj-util`) - none supports `.slnx`,
  none evaluates MSBuild, and all reimplement precisely the semantics we are trying not to get wrong.
- **Roslyn's `MSBuildWorkspace`** - models a _compilation_, not an _organisation_, and drops solution
  folders.
- **Buildalyzer 9.0.** Settled by measurement, not by taste (2026-07-25).
  Its design-time build was 33× slower on a 12-project solution, 70× larger as a payload, raised the
  runtime floor from .NET 8 to .NET 9, and reported generated `obj/*.AssemblyInfo.cs` as project
  sources. It absorbs design-time-build pain we do not have: we need **evaluated items**, not a
  compiler command line.

### Discovery is in Node, not the sidecar

Answering "does this workspace have a solution" decides whether the switcher appears at all, so it
runs for every workspace the user opens - and the overwhelmingly common answer is "none". Spawning a
.NET process to glob for `*.sln` would make it the single most expensive thing in the feature, paid
mostly by workspaces that will never show it.

`dotnet/discover.ts` therefore does a **bounded** walk: depth 3, skipping `node_modules`, `.git`,
`bin`, `obj` and friends. A solution buried six directories deep is not found, and that is the right
trade - the cost of the miss is "no switcher"; the cost of an unbounded walk is paid by everyone. A
`.slnx` beside a same-named `.sln` wins, because that is what `dotnet sln migrate` leaves behind and
two picker entries for one solution would let the user choose the stale one.

### Staleness is checked on read, not pushed by a watcher

The libraries evaluate a point in time; keeping the tree honest is ours. The mechanism is a
**freshness stamp** - mtime and size of the file an answer was derived from - compared on every read.

This is a deliberate departure from reusing `file-explorer/file-watcher.ts`. That watcher is
subscription-scoped: it sees files a client has open in a tab. A `.csproj` almost never has one, and
its writer is at least as likely to be an agent, a `git checkout`, or a `dotnet add package` in a
terminal as the user typing. A cache keyed on "did a tab tell us" would be stale in exactly the cases
that matter. One `stat` before a request that would otherwise cost an MSBuild evaluation is not worth
optimising away, and unlike a watcher it cannot miss a writer.

The push path still exists for the one case a stamp cannot see: a `Directory.Build.props`, a
`.targets` or a `global.json` is an **input** to projects whose own files did not change. Those drop
every solution beneath the changed file, because working out exactly which projects import it would
mean re-deriving MSBuild's import graph - the domain knowledge we deliberately do not own.

Ordinary `.cs` edits invalidate nothing: membership is by glob, so editing a file cannot change which
files are in the project.

### The sidecar's lifecycle

Lazy spawn on first tree request, keyed by (workspace × solution), idle-reaped, capped at two, capped
backoff on crash. It mirrors `lsp/pool.ts` deliberately - the cost profile is the same.

**It does not mirror that subsystem's defect.** `LspService.reapIdle` and `stopAll` shipped with no
production caller, so idle servers never exited. `SolutionService.reapIdle` rides the daemon's
existing reap interval and `stopAll` its shutdown path, and
`websocket-server.lsp-lifecycle.test.ts` asserts both - testing the **wiring**, not the method,
because the method was never the thing that was broken.

Keyed per solution rather than per workspace because a warm `ProjectCollection` is scoped to one
solution's import graph. The workspace root still rides on every key, so `stopWorkspace` can match it
when a workspace is archived - deriving it from the solution's own directory would leave a closed
workspace holding a live process whenever the solution sits in a subdirectory.

## Out-of-workspace projects - stay out of the way

A `.csproj` that lives outside the workspace root is shown and opened like any other. We do not
block it, hide it, or invent a containment story for it. The solution says it is part of the
solution; that is the user's arrangement, not ours to police.

Three consequences, and they are the whole policy:

1. **Reading and opening: unrestricted.** A deliberate, scoped relaxation of the file explorer's
   containment rule, justified because the _solution file itself_ is the authority naming those
   paths - the client is not free-browsing the disk. The `cwd` guard still applies, so a client can
   only reach what a solution Otto already knows about points at.
2. **Editing: direct.** Project ownership adds no warning or permission layer. The file is served
   from a registered owning workspace when one exists, otherwise from its own parent directory.
3. **Git: owner-dependent.** A file resolved to a registered workspace uses that workspace's Git
   surfaces. A file with no registered workspace remains outside Changes, diffs, and commits.

On the wire this is a `path` that is workspace-relative when inside and absolute when not, plus an
explicit `outsideWorkspace` boolean - so nothing downstream infers the distinction by inspecting the
string.

This does **not** make the explorer browse arbitrary paths. Explorer containment governs _browsing_;
this section governs _following a solution's own declarations_.

## Cross-platform

The payload is framework-dependent IL: no `RuntimeIdentifier`, so one build serves Windows, macOS and
Linux, with no per-RID matrix and no NuGet restore at run time. Two properties in the `.csproj` are
load-bearing and easy to break - the `net8.0` target and `RollForward=LatestMajor` - both explained
in [`packages/dotnet-probe/README.md`](../packages/dotnet-probe/README.md).

Two details the libraries do not handle for us, both owned by `solution-model/paths.ts`:

- **Path separators.** The library returns platform separators (`src\App\App.csproj` on Windows) even
  for a `.slnx` that stores forward slashes. The sidecar normalises on its way out and the daemon
  keeps that property, so the wire shape is identical on every OS.
- **Case sensitivity.** Linux paths are case-sensitive where Windows and macOS are not, so comparing
  raw strings gets containment wrong in both directions. `documentKey` - the LSP subsystem's existing
  discipline - is reused rather than re-derived.

**Runtime vs. SDK.** Reading solution structure needs only the .NET runtime; per-project evaluation
needs the **SDK**, because that is MSBuild. The feature could degrade at that finer grain, but per
the feature contract it gates on the SDK rather than shipping a half-tree.

## Protocol

| RPC                                           | Purpose                                                   |
| --------------------------------------------- | --------------------------------------------------------- |
| `code.solution.list.request/response`         | Solutions in a workspace - drives the switcher's presence |
| `code.solution.get_tree.request/response`     | Solution → folders → projects, configurations             |
| `code.solution.load_project.request/response` | One project's evaluated contents, fetched on expand       |

Gate: `server_info.features.solutionView`, marked `COMPAT(solutionView)`. Absent means the client
never shows the switcher and never asks - there is no client-side substitute for reading a solution,
and a hand-parsed half-tree is the mistake this design exists to avoid.

**`list` never reports an error.** A workspace with no solution, a host with no .NET SDK, and a host
with the switch off all answer with an empty array. That collapses four states into one silent case
for the client, and it is why a user who has never opened a .NET project never learns this subsystem
exists.

Structure is **flat with parent links**, not nested. A recursive payload would have to be walked to
be used and every consumer would write that walk again; the file explorer already turns a flat
listing plus an expanded-path set into rows, so this hands it the shape it already consumes.

## The client

Seam 1 of the explorer - **inside the Files tab**, not a fourth tab. It is a second view of the same
thing, and the precedent is the Changes pane's tree-vs-flat toggle.

- `explorerViewModeByCheckout` and `explorerSolutionByCheckout` in `panel-store`, persisted
  **per checkout** via `buildExplorerCheckoutKey`, mirroring `explorerTabByCheckout`. Which lens
  makes sense is a fact about _this_ repository; a user with one .NET repo and five TypeScript ones
  should not have the .NET choice follow them everywhere.
- One switcher, not two controls: the lens toggle and the multi-solution picker are the same
  question, and a separate picker would show a single entry in the common case. **Rendered only when
  `code.solution.list` returned ≥ 1.**
- `buildSolutionRows` in `solution/solution-rows.ts` is the pure funnel from data + expanded ids to
  rows, mirroring `resolveTreeRows`. Row chrome, indent guides, chevrons and file icons are reused
  unchanged from `tree-primitives.tsx`, so the two lenses read as one module.
- Opening a file calls the same handler the Files lens does. The wire carries a workspace-relative
  path precisely so this needs no new tab machinery.
- Controls that do not apply are **absent, not disabled**: sorting is a property of a filesystem
  listing, and "hidden files" has no meaning in a view of what the build system says is in the
  project.
- Directories **inside a project default to expanded**, inverted from the filesystem lens. There is
  no listing to fetch - the whole project arrives in one payload - so collapsing by default would
  hide files for no saving at all.

Per-project status is three-valued (`ok` / `failed` / `unavailable`) plus a client-side `unloaded`
for a project nobody has expanded yet. A project MSBuild refused carries **MSBuild's own message**;
one bad project must not blank the tree.

## Scope

Phase 1 is **read-only**, and the sidecar has no mutation verb at all - the cheapest way to keep
"cannot corrupt a solution" honest is for the process that could do the damage to have no way to.

**Solution filters (`.slnf`) are not supported.** Noted so nobody assumes they work.

Mutation is Phase 2 and 3, tracked in [`projects/README.md`](../projects/README.md). Phase 2 -
general file create/delete/rename/move - is a prerequisite strictly larger than this view and is not
.NET work; it benefits the Files lens identically and must not be smuggled in as a .NET feature.
