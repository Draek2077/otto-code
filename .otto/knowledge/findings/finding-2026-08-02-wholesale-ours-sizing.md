---
id: "finding-2026-08-02-wholesale-ours-sizing"
kind: "finding"
title: "How much of Paseo v0.2.5 did the merge actually drop?"
status: "confirmed"
tags: ["finding", "upstream"]
created_at: "2026-08-16T22:16:11.559Z"
updated_at: "2026-08-16T22:16:11.559Z"
---

# How much of Paseo v0.2.5 did the merge actually drop?

<!-- compiled_truth -->

**Date:** 2026-08-02 · **Question:**
[audit-findings.md](../../../projects/paseo-v025-merge/audit-findings.md) closed with an unsized risk:
"the ~180 _conflict-resolved_ wholesale-ours files are a different set from these 168 byte-identical
ones. A file whose side won a conflict and was then edited is invisible to the byte-identical scan.
That gap is the most likely home of further regressions and nobody has sized it." This sizes it.

## Method

First correction, before any measurement: **the audit was written against a merge that never
landed.** It cites `f395655b5`, which is not an ancestor of `main`. The merge on `main` is
`5e3cc1def`, parents `4d171a4d2` (ours) and `6fc491e62` (upstream v0.2.5), base
`c05e337cde9c88d3c86dc82d9e8bc26b336603b3`. Everything below uses the merge that shipped, compared
against `HEAD` rather than the merge commit, so the repairs since then count.

`deltaTheirs` (how far our tree is from upstream) was tried first and **discarded as misleading**. It
is dominated by Otto's own legitimate divergence: `hooks/use-settings/storage.ts` scores 1,238
against 50 lines of upstream churn, purely because Otto has features upstream never had. Measuring
divergence answers the wrong question.

The metric used instead runs the other way: **of the lines upstream ADDED between the base and
v0.2.5, how many exist in our tree today?** Lines shorter than 12 characters, and pure punctuation or
brace lines, are excluded as too generic to prove anything. Files with fewer than 20 significant
added lines are excluded as too small to judge.

```bash
git diff -U0 --no-renames <base> 6fc491e62 -- 'packages/*'   # upstream's additions
git show HEAD:<file>                                          # our tree today
```

## Result

**723 files** carry 20 or more significant upstream-added lines. **Overall adoption is 88.6%**
(75,767 of 85,496 lines present in our tree today).

| Adoption band            | Files | Lines dropped |
| ------------------------ | ----- | ------------- |
| 90-100% (taken)          | 594   | 864           |
| 50-90% (partly taken)    | 56    | 2,035         |
| 10-50% (mostly dropped)  | 63    | 6,340         |
| 0-10% (dropped outright) | 10    | 490           |

Production and test files behave the same (88.3% vs 89.0%), which rules out the theory that tests
were disproportionately declined.

The risk is concentrated, not spread: **73 files below 50% adoption account for 6,830 of the 9,729
dropped lines.** Restricted to production code that is 48 files and 4,011 lines.

**Of those 48, 25 are named somewhere in the merge notes and 23 are not.** The 23 undocumented files
account for 1,430 dropped lines and are the population the audit was pointing at.

## The line metric alone overstates the problem

Spot-checking the worst file corrected the conclusion. `workspace-scripts-button.tsx` scores 20%
adoption, but upstream's `resolveWorkspaceScriptLink` **is** present, in
`utils/workspace-script-links.ts`, imported and used. Otto re-implemented the capability in its own
idiom, so upstream's exact lines do not survive even though the feature was taken.

So verbatim line survival is a **floor on adoption, not a defect count**, and 88.6% understates how
much was really taken. The low-adoption list is a triage list.

A second pass fixes this by checking **symbols** rather than lines: for each undocumented
low-adoption file, take the top-level functions, classes, types and exported constants upstream
added, and ask whether a symbol of that name exists anywhere in the owning package today.

**12 of the 23 have at least one upstream symbol with no counterpart.** That list still contains
false positives of two kinds, both confirmed by inspection:

- **Rebrand renames.** `PaseoWorktreeChangeRequestLookupTarget` is present as
  `OttoWorktreeChangeRequestLookupTarget`. Not missing, renamed.
- **Internal components renamed in re-implementation.** `mode-control.tsx` lacks
  `useLiveAgentModeControl` but has `AgentModeControl` and `DraftAgentModeControl` doing the job.

## The two that survive scrutiny

**`workspace-scripts-button.tsx`, 7 of 7 new symbols absent** (`ServiceRouteSelector`,
`ServiceRouteOption`, `ServiceRouteTriggerContent`, `ScriptRowActionButton`, `RowActionIconElement`,
`routeLabelKey`). Upstream rewrote this file (+434/-186), adding a service-route affordance: open a
running script's URL, copy it, preview it. None of those symbols or equivalents exist in our tree.

This one already produced a visible symptom that nobody traced to a cause. On 2026-08-02 commit
`32f4a2cd9` "parked the never-merged UI assertions" in `workspace-scripts-button.test.ts`, with the
note that the tests "assert a UI that was never merged". Those tests came across from upstream and
the component did not. The parked assertions are the fingerprint of this drop.

**`workspace-archive-service.ts`, 3 of 7 new symbols absent** (`resolveWorkspaceBackingDirectory`,
`resolveBackingDirectory`, `uniqueFilesystemPaths`). Upstream added backing-directory resolution to
archiving. `isDirectoryUnreferenced`, `requireActiveWorkspaceForArchive` and `resolveArchiveTarget`
did come across, so this is a partial take of one change, which is the shape most likely to be a
correctness bug rather than a declined feature.

## What this rules in and out

- **Ruled out:** the "~19,700 upstream lines dropped" framing. Measured against what shipped, and
  counting only lines substantial enough to mean anything, the tree carries 88.6% of upstream's
  additions, and the true figure is higher still because re-implementation does not preserve lines.
- **Ruled out:** the risk being spread across ~180 files nobody can triage. It is 23 undocumented
  files, of which 12 warrant a look and 2 clearly warrant a fix.
- **Ruled in:** partial takes are the dangerous shape. `workspace-archive-service.ts` took four of
  seven new symbols, which is exactly how `checkout-session.ts` became regression 5.
- **Ruled in:** parked or skipped tests are a leading indicator of a dropped component. The scripts
  button was diagnosed as stale mocks and never traced back to the merge.

Status for anything done about this belongs in
[projects/README.md](../../../projects/README.md), not here.

## Timeline

- time: "2026-08-16T22:16:11.559Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/upstream/2026-08-02-wholesale-ours-sizing.md"
