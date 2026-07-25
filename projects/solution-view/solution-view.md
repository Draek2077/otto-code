# Solution view — the unbuilt phases

**Phases 0 and 1 shipped 2026-07-25.** Everything durable about them — the architecture, the
libraries and why the alternatives were rejected, the "disabled does no work" contract, the
out-of-workspace policy, the cross-platform constraints — now lives in
[docs/solution-view.md](../../docs/solution-view.md). Status lives in
[projects/README.md](../README.md). This file is what remains: the plan for Phases 2 to 4.

## What shipped, in one paragraph

A second Files lens showing the tree as the build system sees it, .NET first. A portable .NET
sidecar over `Microsoft.VisualStudio.SolutionPersistence` plus MSBuild **evaluation** supplies the
domain knowledge; the daemon owns discovery, caching, the process lifecycle and the language-neutral
`SolutionProvider` seam; the client renders it inside the Files tab behind a switcher that appears
only when a solution exists. Read-only, and the sidecar has no mutation verb at all.

## Phase 2 — general file mutations (a prerequisite, and not .NET work)

**Otto has no file create, delete, rename or move RPC.** The entire mutation surface today is
`file.write` (conditional; `allowCreate` only for the deleted-file re-create flow), `file.replace`
(preview-first project-wide replace) and `file.upload`. Directory listing is read-only, one level at
a time.

So "manage files within projects" has a prerequisite strictly larger than the Solution view itself.
That work benefits the Files lens identically and **must not be smuggled in as a .NET feature**.

For SDK-style projects this alone delivers add/remove correctly, because **membership is implicit** —
creating a `.cs` file _is_ adding it to the project, with no `.csproj` edit at all. Explicit-item
projects are the minority that needs real editing, and they are already detectable: the daemon
reports each item's origin as `SolutionProjectNode.isImplicit`, collected during evaluation precisely
so this phase would not need a second pass.

Open before starting: the shape of a create/rename/move RPC family that is honest about
partial failure the way `code.rename.apply` is, and whether a move inside a project needs to be one
transaction with the `.csproj` edit for the explicit-item case.

## Phase 3 — solution and project mutations

Add and remove a project to/from a solution, and manage solution folders — **via
SolutionPersistence's writer**, which round-trips both formats and preserves formatting. New project
from a template (`dotnet new`), references and packages (`dotnet add reference|package`).
`.sln`/`.slnx` are never written by hand.

The sidecar deliberately has no mutation method today; Phase 3 is where `solution.mutate` is added,
and the read-only property it currently enjoys — a view that structurally cannot corrupt a solution —
is what it trades away. Worth an explicit undo story before the first writer lands.

Depends on Phase 2 for the file half.

## Phase 4 — pin the C# language server to the selected solution

`csharp-ls` accepts `--solution`. Today `rootPath` is just the workspace `cwd`, so in a repo with two
solutions the server picks one on its own and we cannot tell which. The user's selection is already
persisted (`explorerSolutionByCheckout`), so pinning the server to it would make code intelligence
and the tree agree.

Requires a small registry extension: `args` are static per row (`lsp/registry.ts`), with no mechanism
for per-workspace dynamic arguments.

Note this is the **one** place the two subsystems touch, and the direction matters: the Solution view
informs the language server, never the other way round. LSP has no project-structure request, which
is the whole reason this subsystem exists.

## Out of scope, recorded so nobody assumes otherwise

**Solution filters (`.slnf`).** Not supported, and not planned as part of the phases above.

## Open questions

None blocking. Two worth settling before the phase that needs them:

1. **Does Phase 3 need an undo?** A rename in the editor has one because a project-wide edit's blast
   radius is invisible. Removing a project from a solution is smaller and more legible, but it is
   still a write to a file the user did not open.
2. **Should `bin`/`obj` be hidden in the Files view too**, now that the Solution view proves we know
   they are build output? Cheap, and a strict improvement for .NET users; the question is whether the
   Files lens should ever take an opinion from a different lens's knowledge.
