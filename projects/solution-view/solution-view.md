# Solution view

**Status:** CHARTER v3 (2026-07-25). **Approved to build**, conditional on cross-platform parity —
which is now **proven by spike**, not assumed (see "Cross-platform"). Nothing shipped.

v1 proposed hand-parsing plus CLI shelling. v2 replaced that with a .NET sidecar over Microsoft's
own libraries. v3 records the decisions that came back: the **"Microsoft .NET Solution Management"**
switch (separate from Code Intelligence, default off, disabled means zero work), the
**out-of-workspace policy** (stay out of the way; warn on edit; git ignores them), and
**prebuilt-once shipping** now that the payload is proven portable.

Give the Files module a second lens: **Solution** — the file tree as the build system sees it
(solutions, projects, references, evaluated file membership) rather than as the filesystem lays it
out. .NET (`.sln` / `.slnx` / `.csproj`) is the first implementation and the acceptance criteria;
the seam it plugs into is language-neutral by construction.

The view is **transparent**: a workspace with no solution never sees the switcher, never pays a
probe cost, and behaves exactly as it does today.

---

## The naming constraint, settled first

**Project is a taken Otto noun** — "a logical grouping of workspaces sharing a git remote"
([docs/glossary.md](../../docs/glossary.md)). A .NET project is a completely different thing, and
the two will appear on screen at the same time (Otto's project sidebar, and a `.csproj` node in the
tree). So:

- The view mode is **Solution** (vs. **Files**). Never "Project view".
- Nodes for `.csproj` are labelled with their own name (`Core`, `App`) and typed `solutionProject`
  in code — never bare `project`.
- Glossary gets one entry, **Solution**, that says explicitly that a .NET project is not an Otto
  **Project**.

This is the same discipline that keeps **Chat** and **Agent** apart.

---

## The switch — "Microsoft .NET Solution Management"

**Decided.** A single enable/disable setting under **Daemon → Code**, a **separate row from Code
Intelligence**. Turning off C# code intelligence does not turn this off, and vice versa — they are
independent capabilities that happen to share a language.

**Disabled is genuinely off, not merely hidden.** No discovery walk, no `.sln`/`.slnx` read, no
`.csproj` parse, no sidecar process, no cache, no watcher subscription — and every related option
disappears from the UI along with the view switcher. The setting is read at the daemon boundary
before any work is scheduled, so a disabled feature costs exactly one boolean check.

Default: **off**. The feature spawns a process and evaluates MSBuild; that should be opted into,
consistent with the LSP charter's lazy/opt-in cost policy.

Setting id `dotnetSolutionManagement`, sibling to the existing `languages[...]` rows rather than a
member of them — putting it inside the LSP settings object would imply exactly the coupling this
decision rejects.

---

## The correction that survives from v1: the LSP gives us nothing here

The premise that "we have language servers that understand solutions" does **not** extend to a
project tree:

- **LSP has no project-structure request.** There is no "describe this solution's projects and their
  file membership" method in the protocol. Not something we haven't wired — something that does not
  exist.
- Otto wires `definition`, `hover`, `references`, `rename`, `diagnostics`. **No `documentSymbol`,
  no `workspaceSymbol`.**
- The C# row's root is just the Otto workspace `cwd`, passed straight through
  (`workspace-files-session.ts:561-566` → `connection.ts:423-457`). **Nothing in `packages/server`
  reads `.sln`, `.slnx`, or `.csproj`** — repo-wide grep hits only the e2e fixture strings.
- `csharp-server.e2e.test.ts` proves `csharp-ls` _initializes_ against a loose folder, a `.sln`, and
  a `.slnx` and finds its own way. That is the server understanding the solution **privately**. It
  never tells us what it found.

**The Solution view must build its own model.** It is independent of the LSP subsystem.

---

## Why v1 was wrong, and what replaces it

v1 proposed: parse `.sln`/`.slnx` ourselves, and get file membership from
`dotnet msbuild <csproj> -getItem:Compile`. That measured well (~0.45 s, exact evaluated items) and
it is genuinely better than reimplementing MSBuild globbing. But it fails the standard that matters
here — **not making mistakes about how .NET actually models projects** — in four concrete ways:

1. **It loses solution folders.** `dotnet sln list` returns a flat list of `.csproj` paths (verified).
   Solution folders — the entire organisational payload of the Solution view — are not exposed by
   any CLI surface. v1 would have hand-parsed them back out of `.sln`'s
   `GlobalSection(NestedProjects)` GUID mapping. That is exactly the class of mistake to avoid.
2. **It has no write path.** Hand-writing `.sln` (project type GUIDs, `SolutionConfigurationPlatforms`,
   `ProjectConfigurationPlatforms`, nested-folder GUID tables) is a corruption risk.
3. **It has no configuration model.** Solution configurations and platforms, and how each project's
   configuration maps onto them, are a first-class .NET concept that `-getItem:` does not surface.
4. **It costs one process per project.** `dotnet msbuild <sln> -getItem:` fails with `MSB1063`
   (properties and items are unavailable for solution files, verified), so N projects means N process
   spawns and N SDK resolutions.

**Microsoft has open-sourced the exact library for (1)–(3), and it is what `dotnet sln` and MSBuild
themselves use.**

---

## The libraries

| Library                                        | Owner / licence               | Scale                                  | What it owns for us                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Microsoft.VisualStudio.SolutionPersistence** | Microsoft, **MIT**            | 50.2M downloads; net8.0 + net472       | `.sln` **and** `.slnx` read **and write**; solution folders and nesting; configurations/platforms; project type GUIDs                                                                                                 |
| **Buildalyzer** 9.0.0                          | Dave Glick / phmonte, **MIT** | 5.9M downloads; published **Apr 2026** | Per-project MSBuild evaluation without hand-rolling design-time builds: items with metadata, project/package references, multi-targeting, SDK resolution. 9.0 added `SolutionInfo`/`ProjectInfo` and **SLNX support** |

The decisive property of SolutionPersistence is that it is _the same parser the toolchain uses_ —
MSBuild, the .NET CLI, and Visual Studio all read the file through it, so our tree cannot disagree
with `dotnet build` about what is in the solution.

Buildalyzer's value is narrower but real: MSBuild evaluation has sharp edges (SDK resolution,
`global.json` pinning, multi-targeting, `Directory.Build.props`, which target to run), and
Buildalyzer is a maintained wrapper whose whole purpose is absorbing them. Using
`Microsoft.Build` + `Microsoft.Build.Locator` directly is the alternative if we want fewer
dependencies; the spike in Phase 0 decides.

**Rejected:** the npm parsers (`vs-parse`, `visualstudiofiles`, `node-csproj-util`) — none supports
`.slnx`, none evaluates MSBuild, and all reimplement precisely the semantics we are trying not to
get wrong. Roslyn's `MSBuildWorkspace` was also considered: it opens a solution and gives
projects + documents through official code, but it models a _compilation_, not an _organisation_ —
it drops solution folders — so it does not replace SolutionPersistence.

---

## Architecture

The user constraint is that this is built through Otto's daemon design, using mature software for
the .NET domain knowledge. Those pull in opposite directions only if you assume the daemon must be
pure Node. It doesn't — **Otto already spawns language-specific helper processes and talks to them
over stdio.** That is exactly what `lsp/pool.ts` does with `csharp-ls`.

### The sidecar

A small .NET console app, `OttoDotnetProbe`, vendored in the repo. Speaks newline-delimited JSON on
stdin/stdout. It is the only thing in Otto that knows what a `.csproj` is.

```
solution.list   { root }            → [{ path, format: "sln"|"slnx", name }]
solution.tree   { solutionPath }    → { folders[], projects[], configurations[], platforms[] }
project.load    { projectPath }     → { items{}, projectReferences[], packageReferences[],
                                        targetFrameworks[], outputType, isSdkStyle }
solution.mutate { op, ... }         → applied via SolutionPersistence / dotnet CLI
```

It holds a warm MSBuild `ProjectCollection`, so evaluating N projects costs one process and one SDK
resolution — the thing v1's per-project CLI spawn could not do.

**Lifecycle mirrors the LSP pool deliberately:** lazy spawn on first Solution-view request, keyed by
(workspace × solution), idle-reaped, capped, restarted with backoff on crash. Where practical it
should reuse `lsp/pool.ts`'s shape rather than grow a parallel one — and it must not repeat the
defect found in that subsystem, where the reaping methods exist but nothing calls them (see
"Adjacent defect" below).

### Cross-platform — proven, not assumed

Cross-platform parity was the condition of approval, so it was spiked before the plan was accepted.
Built and run on Windows with .NET SDK 10.0.301, 2026-07-25:

| Checked                    | Result                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `.slnx` parse              | 3 projects, 2 solution folders (`/Src/`, `/Tests/`), build types `Debug`/`Release`, platform `Any CPU`      |
| Classic `.sln` parse       | Same model, same shape, via `SlnFileV12Serializer` — one code path, two formats                             |
| Solution folders + nesting | Returned as `Path` (`/Src/`) with a `Parent` link — the thing the CLI could not give us                     |
| Write API                  | `AddProject` / `AddFolder` / `RemoveProject` / `RemoveFolder` / `SaveAsync` all present — Phase 3 is real   |
| **Build portability**      | **No `RuntimeIdentifier`. Framework-dependent, IL-only.** Output is 2 DLLs + 2 JSON files, **193 KB total** |
| Invocation                 | `dotnet OttoDotnetProbe.dll <path>` — the same build output runs on Windows, macOS and Linux                |

The proven entry points, so Phase 0 does not rediscover them (note `ISolutionSerializer` lives in
the **root** namespace, not `.Serializer`, which is the one thing that does not autocomplete
obviously):

```csharp
using Microsoft.VisualStudio.SolutionPersistence;          // ISolutionSerializer
using Microsoft.VisualStudio.SolutionPersistence.Model;    // SolutionModel, SolutionProjectModel
using Microsoft.VisualStudio.SolutionPersistence.Serializer; // SolutionSerializers

ISolutionSerializer? s = SolutionSerializers.GetSerializerByMoniker(path); // picks sln vs slnx
SolutionModel model = await s.OpenAsync(path, ct);
// model.SolutionProjects → FilePath, ActualDisplayName, TypeId, Parent
// model.SolutionFolders  → Name, Path ("/Src/"), Parent, Files
// model.BuildTypes, model.Platforms
// write: AddProject / AddFolder / RemoveProject / RemoveFolder, then s.SaveAsync(path, model, ct)
```

**This settles the shipping question: build once, ship everywhere.** A framework-dependent .NET
build is IL, not native code, so there are no per-RID artifacts, no per-platform build matrix, and
no NuGet restore at runtime. One 193 KB payload works on all three platforms.

That is strictly better than v2's original build-on-first-use suggestion, which would have needed
network access for a NuGet restore on first run — a real "extra complication" on an offline or
locked-down machine. Prebuilt-once removes it.

Two cross-platform details that still need care:

- **Path separators.** The library returned `src\App\App.csproj` on Windows even though `.slnx`
  stores forward slashes. Normalise to forward slashes at the sidecar boundary so the wire shape is
  identical on every OS.
- **Case sensitivity.** Linux paths are case-sensitive where Windows and macOS are not. Reuse the
  LSP subsystem's `documentKey` discipline rather than comparing raw strings.

**Runtime vs. SDK:** reading the solution structure needs only the **.NET runtime** (193 KB payload

- `Microsoft.NETCore.App`). Per-project evaluation needs the **SDK**, because that is MSBuild. The
  feature can therefore degrade honestly at a finer grain than expected — but per the feature
  contract we still gate the whole thing on the SDK rather than shipping a half-tree.

### Daemon — `packages/server/src/server/solution-model/`

New subsystem, sibling to `lsp/`. No dependency on it.

| File                  | Owns                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `provider.ts`         | `SolutionProvider` interface — the language-neutral seam                  |
| `dotnet/probe.ts`     | Sidecar process: spawn, handshake, JSON framing, timeouts, exit reporting |
| `dotnet/pool.ts`      | Lifecycle keyed by (workspace × solution); lazy, idle-reaped, capped      |
| `dotnet/bootstrap.ts` | Locate the .NET SDK and the prebuilt sidecar payload; report absence      |
| `cache.ts`            | Per-solution model, invalidated by the existing file watcher              |
| `service.ts`          | RPC-facing façade; SDK probe; the three-valued status                     |

**Cache invalidation** reuses `file-watcher.ts`: a change to any `*.sln`, `*.slnx`, `*.csproj`,
`*.props`, `*.targets`, or `global.json` drops the affected project's evaluation. Ordinary `.cs`
edits do not (membership is by glob; creation/deletion is watched separately).

**The generic seam** — .NET is implementation #1, not the interface:

```ts
interface SolutionProvider {
  readonly id: string; // "dotnet"
  detect(root: string): Promise<SolutionRef[]>; // [] ⇒ silent, no switcher
  loadTree(ref: SolutionRef): Promise<SolutionNode>;
  loadProject(ref: ProjectRef): Promise<ProjectContents>;
}
```

Cargo workspaces, npm workspaces, and Gradle multi-project fit this shape later. Building the
interface now costs almost nothing; retrofitting it after a hardcoded .NET tree costs a rewrite.
This mirrors the fork's stated rule — design provider-agnostic, treat one implementation as the
proof, not the finish line.

### Protocol

New RPCs, dotted namespace per [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md):

| RPC                                      | Purpose                                             |
| ---------------------------------------- | --------------------------------------------------- |
| `code.solution.list.request/response`    | Solutions in a workspace (drives switcher presence) |
| `code.solution.tree.request/response`    | Solution → folders → projects                       |
| `code.solution.project.request/response` | One project's evaluated contents (lazy)             |

Node shape is a **discriminated union** — `solution | folder | solutionProject | directory | file` —
carrying a workspace-relative `path` so opening reuses the existing file-open path verbatim. Folders
are virtual and carry no path.

Gate: `server_info.features.solutionView`, with a single
`// COMPAT(solutionView): added in v0.X.Y` marker. Absent ⇒ "Update the host", never a degraded tree.

### Client

Seam 1 from the explorer map — **inside the Files tab**, the smallest honest diff:

- `explorerViewMode: "files" | "solution"` in `panel-store`, persisted **per-checkout** via the
  existing `buildExplorerCheckoutKey`. Mirrors `explorerSortOption`.
- Switcher in the `FileExplorerPaneContent` toolbar (`file-explorer-pane.tsx:1200-1268`), beside the
  sort cycle and hidden-files eye — **rendered only when `code.solution.list` returned ≥ 1**. The
  precedent for a two-lens toggle is `useChangesPreferences.viewMode` (tree vs. flat in Changes).
- Branch at `resolveTreeRows` (`file-explorer-pane.tsx:1412`) — already the single pure funnel from
  data + expanded-paths to `TreeRow[]`. `TreeRow` gains a discriminator; `TreeRowDispatcher` (1507)
  grows cases. Row chrome, indent guides, chevrons, and file icons are reused unchanged from
  `tree-primitives.tsx`.
- Opening a file calls the existing `handleOpenFile` (655). No new tab machinery.

---

## Out-of-workspace projects — decided: stay out of the way

**Decided.** A `.csproj` that lives outside the workspace root is shown and opened like any other.
We do not block it, do not hide it, and do not invent a containment story for it. The solution says
it is part of the solution; that is the user's arrangement, not ours to police.

Three consequences, and they are the whole policy:

1. **Reading and opening: unrestricted.** The Solution view renders out-of-workspace projects and
   their files normally. This is a deliberate, scoped relaxation of the file explorer's containment
   rule, justified because the _solution file itself_ is the authority naming those paths — the
   client is not free-browsing the disk.
2. **Editing: allowed, but warned.** Editing a file outside the project surfaces a warning. The
   existing `resolveEditGate` (`free | other-project | outside-project`) already models exactly this
   and already has UI — reuse it rather than growing a parallel warning.
3. **Git: not our problem.** Out-of-workspace files are excluded from Changes, diffs, commits,
   and every other git surface, with no special-casing anywhere. They are outside the repo; the
   user owns that.

This supersedes the v1/v2 "Phase 1 blocker" — there is no blocker, there is a policy.

Note this does **not** reverse `gated-multi-root`'s decision that the explorer shows only this
project's files. That rule governs _browsing_; this governs _following a solution's own
declarations_. Worth a line in that project's doc so the two don't read as contradictory.

## What we still own, and must not get wrong ourselves

The libraries cover solution structure and project evaluation. They do **not** cover:

- **Path normalisation.** Separators and case, per the cross-platform section above.
- **The sidecar trust boundary.** It runs MSBuild evaluation, which executes SDK-provided imports.
  This is the same trust level as running `dotnet build`, which agents already do — but it should be
  stated, not assumed.
- **Staleness.** Libraries evaluate a point in time; keeping the tree honest as files change is ours.

---

## Phases

### Phase 0 — spike and seam (no UI)

**Half done already** — the SolutionPersistence spike is proven (see the cross-platform table): both
formats, solution folders with nesting, configurations, platforms, the write API, and a portable
193 KB build. What remains in Phase 0:

- **Decide Buildalyzer vs. raw `Microsoft.Build`** on a real multi-project solution; measure
  warm-`ProjectCollection` evaluation for N projects.
- Promote the spike into `packages/dotnet-probe/`, add the JSON stdio protocol and the CI build step
  that produces the portable payload.
- `detect()` + `code.solution.list` + **the `dotnetSolutionManagement` setting and its off-path**
  — the off-path is a Phase 0 deliverable, not a later refinement, so "disabled does no work" is
  true from the first commit rather than retrofitted.

### Phase 1 — read-only Solution view ← **the MVP**

Tree, lazy project evaluation, the switcher, opening files. Solution folders as virtual nodes.
Per-project status (loaded / evaluating / failed, with MSBuild's own error text).

For a .NET developer the daily value is **seeing the code organised the way the build organises it**
— projects in solution-folder order, test projects beside their subjects, `bin`/`obj` gone without a
gitignore rule, and files that are actually compiled distinguished from files that merely sit on
disk. That last point is the one a filesystem tree structurally cannot show.

Ships alone, useful alone, mutation-free — so it cannot corrupt a solution.

### Phase 2 — general file mutations (prerequisite, not .NET work)

**Otto has no file create, delete, rename, or move RPC.** The entire mutation surface today is
`file.write` (conditional; `allowCreate` only for the deleted-file re-create flow), `file.replace`
(preview-first project-wide replace), and `file.upload`. Directory listing is read-only, one level
at a time.

So "manage files within projects" has a prerequisite strictly larger than the Solution view itself.
That work benefits the Files view identically and should not be smuggled in as a .NET feature.

For SDK-style projects this alone delivers "add/remove files in a project" correctly, because
**membership is implicit — creating a `.cs` file _is_ adding it to the project, with no `.csproj`
edit at all.** Explicit-item projects are the minority that needs real editing, and they are
detectable: evaluation reports each item's defining project (SDK defaults vs. the project itself).

### Phase 3 — solution and project mutations

Add/remove a project to/from a solution and manage solution folders — **via SolutionPersistence's
writer**, which round-trips both formats and preserves formatting. New project from template
(`dotnet new`), references and packages (`dotnet add reference|package`). `.sln`/`.slnx` are never
written by hand.

### Phase 4 — LSP tie-in

`csharp-ls` accepts `--solution`. Today `rootPath` is just the workspace `cwd`, so in a repo with two
solutions the server picks one on its own and we cannot tell which. Once the user has _selected_ a
solution in the UI, pinning the server to it makes code intelligence and the tree agree.

Requires a small registry extension: `args` are static per row today (`registry.ts:51-130`), with no
mechanism for per-workspace dynamic arguments.

---

## Risks and edges

| Edge                                                                 | Handling                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`.csproj` outside the workspace root** (`..\Shared\Shared.csproj`) | **Decided — stay out of the way.** Shown and opened normally; warn on edit via `resolveEditGate`; excluded from all git surfaces. See the policy section above. No longer a blocker. |
| **Sidecar is a new build artifact**                                  | One CI step producing a portable 193 KB IL payload — no per-RID matrix, no runtime restore. Proven in the Phase 0 spike.                                                             |
| **Path separators / case across OS**                                 | Normalise to forward slashes at the sidecar boundary; reuse the LSP `documentKey` discipline for case. The library returns platform separators.                                      |
| **Multiple solutions in one repo**                                   | Picker in the switcher; the selection also decides Phase 4's `--solution`.                                                                                                           |
| **No .NET SDK on the daemon host**                                   | No switcher, silently. Per the feature contract — no degraded mode. (Structure alone needs only the runtime; we still gate on the SDK rather than ship a half-tree.)                 |
| **Feature disabled**                                                 | Zero work: no discovery, no parse, no sidecar, no watcher, no UI. Checked at the daemon boundary. Default off.                                                                       |
| **A project that fails to evaluate**                                 | Per-node error carrying MSBuild's own message. One bad project must not blank the tree.                                                                                              |
| **Large solutions** (50+ projects)                                   | Lazy per-project evaluation; cost paid only on expand. Warm `ProjectCollection` makes this far cheaper than v1's per-project process.                                                |
| **`global.json` SDK pinning**                                        | Buildalyzer/MSBuild honour it. Worth an explicit test.                                                                                                                               |
| **Solution filters (`.slnf`)**                                       | Out of scope for Phase 1. Noted so nobody assumes it works.                                                                                                                          |
| **`gated-multi-root` decision**                                      | Its rule governs _browsing_; this governs _following a solution's own declarations_. Not a reversal, but add a cross-reference line to that project's doc.                           |

---

## Open questions

Settled since v2: the switch and its placement, out-of-workspace policy, sidecar shipping
(prebuilt-once, proven portable), and cross-platform parity. What remains:

1. **Buildalyzer vs. raw `Microsoft.Build`** — one dependency that absorbs design-time-build pain, or
   fewer dependencies and more of our own code? The SolutionPersistence half is already proven; this
   is the only remaining Phase 0 spike.
2. **Does Solution view replace the tree, or add a section above it?** Charter assumes replace
   (a mode), matching how Changes does tree-vs-flat.
3. **Should `bin`/`obj` be hidden in the Files view too** once we know they are build output?

---

## Adjacent defect found during investigation (not this project's work)

`LspService.reapIdle`, `setActiveWorkspace`, `stopWorkspace`, and `stopAll` have **zero production
call sites** — they exist only in tests. Idle language servers therefore never exit, the
`backgroundIdleMinutes` setting is inert, and servers are not stopped on daemon shutdown. Only the
LRU cap (`maxRunningServers: 6`) bounds the process count. The
[LSP charter](../../docs/code-intelligence.md) states the daemon calls `reapIdle()`
on an interval; it does not.

**This matters directly here:** the sidecar pool copies that lifecycle shape, so it must not copy
the defect.
