---
id: "finding-2026-09-29-msbuild-worker-accumulation"
kind: "finding"
title: "MSBuild workers persisted after their build parents exited"
status: "proposed"
tags: ["finding","msbuild","process-lifecycle","windows"]
created_at: "2026-09-29T17:57:14.190Z"
updated_at: "2026-09-29T18:04:49.555Z"
---
# MSBuild workers persisted after their build parents exited

<!-- compiled_truth -->

On Windows, reusable MSBuild worker nodes accumulated outside Otto's direct .NET process registry. Another agent reported clearing 78 `dotnet.exe ... MSBuild.dll /nodeReuse:true` workers on 2026-09-29 and seeing zero at 11:44. A read-only process snapshot later found three more workers with `/nodeReuse:true`, all created at 11:51 with parent PID 64876 no longer running. The command or Otto action that started those builds is not established. Otto's registry covers the C# language server and Solution sidecar, not agent tool commands, terminals, or workspace scripts. A source change now sets `MSBUILDDISABLENODEREUSE=1` at daemon creation so local child processes inherit it; this has passed build, typecheck, and targeted lint, but has not been installed or proved against the reported workload. MSBuild can still create parallel workers during a build, and an explicitly overriding invocation or remote execution may require separate handling.

## Timeline

- time: "2026-09-29T17:57:14.190Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-29T17:57:14.190Z"
  kind: "evidence"
  summary: "User-relayed cleanup report, 2026-09-29: 78 workers cleared, zero at 11:44; one burst 23 on a 24-logical-processor host, later bursts 55. Local `Get-CimInstance Win32_Process` at 11:55 showed PIDs 57528, 59736, 49288 created at 11:51 with parent 64876 absent and command line `dotnet.exe ... MSBuild.dll /nodeReuse:true`. Source inspection: `packages/server/src/server/dotnet-process-registry.ts` counts direct LSP and Solution sidecar processes; `packages/server/src/server/process-tree.ts` sets no-node-reuse only for those launches; `packages/server/src/server/bootstrap.ts` now sets it for daemon descendants. `npm run build:server`, `npm run typecheck`, targeted lint, and `process-tree.test.ts` passed. Microsoft MSBuild source and docs identify `MSBUILDDISABLENODEREUSE=1` as the no-reuse control."
- time: "2026-09-29T18:00:06.818Z"
  kind: "evidence"
  summary: "A live `dotnet build RouteOS.slnx --no-restore -warnaserror -v quiet` parent (PID 52324) spawned approximately 20 `dotnet.exe ... MSBuild.dll /nodeReuse:true` children at 11:58:57. The parent exited within minutes; the worker processes remained. This directly verifies an ordinary CLI build can create a machine-core-sized burst and leave resident workers. The ancestry above the build parent was gone before capture, so this still does not prove which Otto agent or action initiated it. The daemon-start no-reuse change addresses retention after build, but does not bound active parallel workers."
  source: "Read-only Win32_Process snapshot at 2026-09-29 11:59 local time"
- time: "2026-09-29T18:04:49.555Z"
  kind: "evidence"
  summary: "Controlled eight-project `dotnet msbuild Build.proj -m` with `MSBUILDDISABLENODEREUSE=1` and `DOTNET_PROCESSOR_COUNT=4` exited 0, peaked at seven worker processes, and left zero after exit. This disproves the proposed processor-count environment setting as an MSBuild worker cap on this SDK; it was removed from the source change. The no-node-reuse environment setting remains the scoped retention mitigation. A hard cap on active arbitrary agent-initiated builds remains unresolved."
  source: "Isolated `.tmp/msbuild-process-proof` run on .NET SDK 10.0.301, 2026-09-29"
