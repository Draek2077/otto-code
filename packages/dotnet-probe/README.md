# `OttoDotnetProbe` - the .NET solution sidecar

The only thing in Otto that knows what a `.csproj` is. A small .NET console app that speaks
newline-delimited JSON on stdin/stdout; the daemon's `solution-model/` subsystem owns its
lifecycle exactly the way `lsp/pool.ts` owns a language server's.

Architecture and the decisions behind it: [docs/solution-view.md](../../docs/solution-view.md).

## Build

```bash
npm run build:dotnet-probe
```

Output lands in `dist/` (5 files, ~257 KB) and is copied into `packages/server/dist/dotnet-probe`
when that directory already exists, which is the layout a published server tarball uses.

**That destination is written down once,** in
[`scripts/dotnet-probe-paths.mjs`](../../scripts/dotnet-probe-paths.mjs), and both the build script
and the daemon's `solution-model/dotnet/bootstrap.ts` are pinned to it by `bootstrap.test.ts`. They
were hand-written separately once and drifted a directory apart, and a repo checkout's fallback to
this package's own `dist/` hid that from everyone who was not running a published build. One
further thing has to stay true, and it fails silently and green: the server package's `files` array
has to cover `dist/dotnet-probe`, because `npm pack` ships an allowlist.

**You should not need to run it by hand.** A server build wipes `packages/server/dist` and takes
the payload with it, so `build:server` and `build:server:clean` each end by running this script.
That is the only thing enforcing the ordering - do not re-document it as a manual step somewhere
else, and do not add a second caller. The warm cost is ~2 s against a build that runs `tsc` over
five packages.

`dotnet` is needed to _build_ the payload, not to consume it. Without the SDK the script exits 0,
you get the rest of the repo working normally, and you have no Solution view. `--required` turns a
missing SDK into a hard failure instead, for a release runner that must not ship without the
sidecar; nothing passes it today.

## Why the payload is portable

Framework-dependent, IL only - no `RuntimeIdentifier`, so there is no per-RID build matrix and no
NuGet restore at run time. The same five files run on Windows, macOS and Linux.

Two properties in the `.csproj` are load-bearing and easy to break:

- **`TargetFramework` is `net8.0`.** `Microsoft.Build` 17.11.48 is the last version shipping
  `net8.0` assets; 17.12 and later ship `net472` + `net9.0` only. Moving up raises the runtime
  floor for every user of the feature, and .NET 8 is the current LTS.
- **`RollForward` is `LatestMajor`.** A framework-dependent app pins its major version. Without
  this, a `net8.0` payload refuses to start on a host that has only .NET 9 or 10 - which is a
  perfectly ordinary machine, and is what the Phase 0 spike hit.

## Protocol

One JSON object per line in, one per line out. On start the process emits a handshake before
reading anything:

```json
{ "protocolVersion": 1, "sdkVersion": "10.0.301", "msbuildPath": "…", "ready": true }
```

Requests are `{ "id", "method", "params" }`; responses are `{ "id", "ok": true, "result" }` or
`{ "id", "ok": false, "error": { "message" } }`.

| Method               | Params             | Result                                                                                      |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `solution.tree`      | `{ solutionPath }` | `{ solutionPath, format, name, folders[], projects[], buildTypes[], platforms[] }`          |
| `project.load`       | `{ projectPath }`  | `{ projectPath, items{}, projectReferences[], packageReferences[], targetFrameworks[], … }` |
| `project.invalidate` | `{ projectPath? }` | drops one evaluation, or all of them                                                        |
| `ping`               | -                  | `{ pong: true }`                                                                            |

**Every path out is absolute and forward-slashed.** The library returns platform separators
(`src\App\App.csproj` on Windows) even for a `.slnx` that stores forward slashes, so normalising
at this boundary is what makes the wire shape identical on every OS. Workspace-relative paths are
the daemon's business; this process has never heard of a workspace.

**There is no discovery method.** Answering "does this workspace have a solution" decides whether
the switcher appears at all, so it runs for every eligible workspace - spawning a .NET process to
glob for `*.sln` would be the feature's largest single cost and would be paid mostly by workspaces
that have no solution. The daemon walks the directory itself in
`solution-model/dotnet/discover.ts`, and only spawns this process once a tree is actually
requested.

**There is no mutation method,** and there will not be one until Phase 3. Phase 1 ships a view
that cannot corrupt a solution; the cheapest way to keep that promise honest is for the process
that could do the damage to have no verb for it.

## Trust boundary

`project.load` runs MSBuild _evaluation_, which executes the SDK-provided imports for the project
being read. That is the same trust level as running `dotnet build` in the workspace, which agents
already do - but it is a real boundary and is stated rather than assumed. It is also why the
feature is opt-in and off by default.

## Evaluation, not a design-time build

Phase 0's remaining open question was Buildalyzer versus raw `Microsoft.Build`. Measured on a
12-project solution (2026-07-25, .NET SDK 10.0.301); the full method and the hypotheses it retired
are the Buildalyzer-versus-MSBuild finding in Otto Knowledge:

|                                      | raw `Microsoft.Build` evaluation       | Buildalyzer 9.0.0 design-time build                     |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------- |
| 12 projects                          | **591 ms** (first 227 ms, rest ~33 ms) | **19,323 ms** (first 4,038 ms, rest ~1.4 s)             |
| Payload                              | **257 KB**, 5 files                    | 31 MB, 49 files                                         |
| Runtime floor                        | .NET 8                                 | .NET 9 - Buildalyzer needs `Microsoft.Build` ≥ 17.14.28 |
| `Compile` items for a 5-file project | 5                                      | 7 - includes generated `obj/*.AssemblyInfo.cs`          |

The last row is the correctness argument, not just the performance one: a design-time build models
a **compilation**, and the Solution view models an **organisation**. Buildalyzer absorbs
design-time-build pain we do not have - we need evaluated items, not a compiler command line.
