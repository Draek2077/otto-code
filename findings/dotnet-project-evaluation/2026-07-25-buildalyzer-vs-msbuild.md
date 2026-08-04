# Buildalyzer 9.0 versus raw `Microsoft.Build`, for reading .NET project membership

**Date:** 2026-07-25
**Question:** The [Solution view](../../docs/solution-view.md) needs each project's evaluated file
membership. Its charter left one Phase 0 spike open: use **Buildalyzer 9.0** - one dependency that
absorbs design-time-build pain - or **raw `Microsoft.Build` + `Microsoft.Build.Locator`**, fewer
dependencies and more of our own code?

**Outcome: raw `Microsoft.Build`, and it is not close.** On a 12-project solution Buildalyzer was
**33× slower**, its payload **70× larger**, and it **raised the runtime floor from .NET 8 to .NET 9**.
It also reported two files a five-file project does not contain. The reframing that settles it: we
need MSBuild **evaluation**, not a design-time **build** - those are different operations, and only
one of them models an organisation rather than a compilation.

---

## Environment

|                         |                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host                    | Windows 11, `otto-code` checkout                                                                                                                 |
| .NET SDKs installed     | 9.0.315, 10.0.301                                                                                                                                |
| .NET runtimes installed | 7.0.20, 9.0.17, 10.0.9 - **no 8.0** (this turns out to matter)                                                                                   |
| Packages                | `Microsoft.VisualStudio.SolutionPersistence` 1.0.52, `Microsoft.Build` 17.11.48 / 17.14.28, `Microsoft.Build.Locator` 1.9.1, `Buildalyzer` 9.0.0 |

## Method

A synthetic solution of **12 projects** in two solution folders (`/Src/`, `/Tests/`), each project
holding 5 `.cs` files, one `PackageReference`, one `ProjectReference` to its predecessor, and an
`obj/` containing a decoy `.cs` file. Both candidates read the same fixture.

- **Raw** - `MSBuildLocator.RegisterDefaults()`, then one `ProjectCollection` reused across all 12
  `LoadProject` calls, reading `Compile` / `ProjectReference` / `PackageReference` items and the
  `TargetFramework` and `OutputType` properties.
- **Buildalyzer** - `new AnalyzerManager(solutionPath)`, then `.Build()` per project, reading
  `SourceFiles` and `ProjectReferences`.

Reproduce with the shipped fixture, which is a smaller version of the same shape:

```bash
npm run build:dotnet-probe && node scripts/verify-dotnet-probe.mjs
```

## Results

|                                      | raw `Microsoft.Build` evaluation | Buildalyzer 9.0.0 design-time build |
| ------------------------------------ | -------------------------------- | ----------------------------------- |
| 12 projects, total                   | **591 ms**                       | **19,323 ms**                       |
| First project                        | 227 ms                           | 4,038 ms                            |
| Each subsequent project              | ~33 ms                           | ~1.4 s                              |
| Published payload                    | **257 KB**, 5 files              | 31 MB, 49 files                     |
| Lowest runtime it will start on      | .NET 8                           | .NET 9                              |
| `Compile` items for a 5-file project | **5**                            | 7                                   |

### The warm collection is the whole cost argument

227 ms for the first project and ~33 ms for each one after is SDK resolution and the import graph
being paid **once**. That is the property the v1 plan could not have: `dotnet msbuild <sln>
-getItem:` fails outright (`MSB1063` - properties and items are unavailable for solution files), so
membership would have cost one process spawn and one SDK resolution per project.

Buildalyzer does not get this either. Its ~1.4 s per project after a 4 s first project is a
design-time build per project, which is the same shape v1 was rejected for, at a higher constant.

### The two extra files are a correctness argument, not a performance one

Buildalyzer reported **7** sources for a project with 5 files on disk. The extras were
`obj/Debug/net8.0/*.AssemblyInfo.cs` and `*.GlobalUsings.g.cs` - generated inputs to the compiler,
correctly included in a **compilation**, and wrong in a **file tree**. The Solution view models an
organisation; `bin`/`obj` being absent is one of the reasons it is worth having.

This is the finding that changes the framing. Buildalyzer's value proposition - absorbing SDK
resolution, `global.json` pinning, multi-targeting and design-time-build sharp edges - is real, but
it solves a problem we do not have. `ProjectCollection` evaluation already expands the SDK's default
globs, honours `Directory.Build.props` and `global.json`, and reports `TargetFrameworks` for a
multi-targeted project. It just does not run the compiler, which is the point.

### The runtime floor is a portability regression

Buildalyzer 9.0.0 requires `Microsoft.Build >= 17.14.28`. Package assets by version:

| `Microsoft.Build`                     | `lib/`                 |
| ------------------------------------- | ---------------------- |
| 17.11.4, **17.11.48**                 | `net472`, **`net8.0`** |
| 17.12.50, 17.13.26, 17.14.8, 17.14.28 | `net472`, `net9.0`     |

**17.11.48 is the last version with `net8.0` assets.** Taking Buildalyzer therefore forces the
sidecar to `net9.0`, off the current LTS, for a feature whose condition of approval was
cross-platform portability. (17.11.4 additionally carries advisory `GHSA-w3q9-fxm7-j8fq`; 17.11.48 is
the fixed patch and is what shipped.)

## Retired along the way

- **"A framework-dependent `net8.0` payload runs anywhere with .NET 8 or newer."** False by default.
  The first build refused to start on this host - runtimes 7/9/10, no 8 - with
  `You must install or update .NET to run this application`. A framework-dependent app pins its major
  version; `<RollForward>LatestMajor</RollForward>` is what makes the portability claim true, and the
  charter's "one payload works on all three platforms" was only correct with it. Now set, and
  explained in [packages/dotnet-probe/README.md](../../packages/dotnet-probe/README.md).
- **"~193 KB payload."** The spike's figure was SolutionPersistence alone. With
  `Microsoft.Build.Locator` in - needed for evaluation, not for structure - it is **257 KB across 5
  files**. Still one order of magnitude below the alternative and still per-RID-free.
- **"`ExcludeAssets=runtime` on `Microsoft.Build` is a trick that might not hold."** It holds, and it
  is what keeps the payload small: MSBuild's assemblies come from the installed SDK at run time via
  `MSBuildLocator`, which is also the only way evaluation can agree with `dotnet build`. The
  constraint it brings is that **no MSBuild type may be touched before registration** - the CLR loads
  a type's assembly when it first JITs a method mentioning it, so all MSBuild-shaped code lives
  behind a class the entry point only reaches after `RegisterDefaults()` succeeds.

## What this established

The durable half has graduated into [docs/solution-view.md](../../docs/solution-view.md) and
[packages/dotnet-probe/README.md](../../packages/dotnet-probe/README.md). What gets done next is a
row in [projects/README.md](../../projects/README.md).
