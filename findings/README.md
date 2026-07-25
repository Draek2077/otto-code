# Findings — measured investigations

**This tree holds evidence.** One folder per investigation: what was measured, how, what the numbers
were, and what they ruled in or out.

Navigation: [Repository documentation index](../README.md#documentation) ·
[Software documentation (`docs/`)](../docs/README.md) ·
[Charters and the open-work ledger (`projects/`)](../projects/README.md) ·
[Agent working rules (`CLAUDE.md`)](../CLAUDE.md)

## Why this tree exists

The other trees each refused this content, correctly:

| Tree        | Tense                              | Why a findings report does not fit                                                                |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/`     | Present — _this is how it behaves_ | A finding is dated and provisional. Documentation that might be wrong stops being a specification |
| `projects/` | Future — _this is what we build_   | Charters describe intent, and its rules explicitly bar progress documents and second registries   |
| `findings/` | Past — _this is what we measured_  | Evidence: reproducible, dated, superseded rather than edited                                      |

Without a home, evidence gets pasted into a charter (where it rots into stale status) or promoted
into `docs/` (where a dated measurement gets read as a permanent fact). Both were tried here first.

## The rules

1. **One folder per investigation**, named for the question — not for the fix. The report is
   `<folder-name>/<YYYY-MM-DD>-<slug>.md`. A follow-up run is a new dated file beside it, never an
   edit to the old one: a finding is a record of what was true on a date.
2. **Numbers or it did not happen.** Every claim carries the measurement that supports it, the
   environment it ran in, and the command that reproduces it. A report with no method section is an
   opinion.
3. **Report what you measured, including the surprises.** Retired hypotheses are the most valuable
   rows — they stop the next person re-running the same experiment. Never delete one because the
   final diagnosis went elsewhere.
4. **Findings do not carry status.** What gets done about a finding is a row in
   [`projects/README.md`](../projects/README.md). Link to it; do not restate it.
5. **The durable half graduates.** When a finding establishes something evergreen — a technique, an
   invariant, a property of the system that will still be true after the fix — write that into
   `docs/` and leave the evidence here. The report is the audit trail for the doc.
6. **Superseded, not deleted.** A finding overturned by later work gets a note at the top pointing at
   the newer file. It stays: knowing that we once believed something, and why, is the point.

## Reports

| Investigation                                                                                  | Date       | Question                                                                                                            | Outcome                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [client-performance](client-performance/2026-07-25-fps-degradation.md)                         | 2026-07-25 | Why does app-wide FPS degrade the longer Otto stays open, while the Visualizer stays smooth?                        | No classic leak. Timer leak, cache growth and message-decode cost all retired by measurement. **Its workspace-tree conclusion is withdrawn** by the row below; navigation refetch stands                                |
| [client-performance](client-performance/2026-07-25-workspace-tree-retention.md)                | 2026-07-25 | Does the workspace deck actually evict above its cap, and what does a retained tree cost?                           | Eviction fires and fully releases the tree — the earlier soak never crossed the cap of 3. The −35% frame cost behind it is a one-sample statistic that flips verdict between identical runs                             |
| [client-performance](client-performance/2026-07-25-navigation-refetch-and-stream-retention.md) | 2026-07-25 | How much navigation traffic is the client re-asking for state it holds, and what does releasable stream state cost? | Three redundant round-trips per workspace visit, all now at their floor: 232 → 99 inbound messages and 267ms → 130ms handler time over 12 navigation cycles. Records the release trigger decided for the stream buffers |
| [dotnet-project-evaluation](dotnet-project-evaluation/2026-07-25-buildalyzer-vs-msbuild.md)    | 2026-07-25 | Buildalyzer 9.0 or raw `Microsoft.Build`, for reading a .NET project's file membership?                             | Raw, decisively: 33× faster, 70× smaller, one runtime major lower, and more correct. We need **evaluation**, not a design-time build. Retired: "a `net8.0` payload runs on any newer runtime" — it needs `RollForward`  |
