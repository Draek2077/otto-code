---
id: "structural-diff-audit-correctness-and-performance-gaps"
kind: "finding"
title: "Structural diff audit finds correctness and performance gaps"
status: "proposed"
tags: ["diffs", "structural-diff", "performance", "testing", "code-review"]
created_at: "2026-08-13T08:02:09.086Z"
updated_at: "2026-08-13T08:02:09.086Z"
---

# Structural diff audit finds correctness and performance gaps

<!-- compiled_truth -->

# Verified finding

The current Structural diff implementation is a promising shared review foundation, but it does not yet meet the project's Difftastic-level correctness, language, interaction, or performance bar.

## Algorithm and result validity

- The planner remains line-oriented. It runs an LCS line diff, normalizes each changed line with lexical regular expressions, and uses monotonic dynamic programming to pair removed and added lines. Parser context contributes only a small tie-breaker after lexical similarity is already at least 0.35; it does not diff syntax trees or delimiters.
- The curated corpus contains eight copied Difftastic source pairs plus locally-authored fixtures. The fixture table declares aggregate pairing counts and expected block kinds, but the main corpus loop does not assert those values. It asserts availability, source reconstruction for render rows, and a few selected replacements. This is weaker than the documented claim that every case gates shared context, replacements, additions/removals, moves, and formatting.
- No Structural renderer browser/E2E or rendered-artifact regression was found. Existing app E2E coverage does not exercise Structural selection, fallback reasons, review interactions, scrolling, split-layout behavior, or parity across Changes, History, Refine, and tool/edit cards.

## Language capability

The capability gate equates every syntax-highlighting parser with a validating semantic parser. This is not valid for stream highlighters.

A read-only probe against the current registry observed:

- valid nested SCSS was rejected as `invalid-source`;
- valid Objective-C was rejected as `invalid-source`;
- malformed Swift, shell, SQL, and Dart were accepted as Structural-capable;
- the accepted stream-parser contexts were shallow token roles such as `keyword`, not language syntax structure.

The one-pair-per-extension matrix uses subset syntax that avoids these failures, so it proves registry coverage rather than meaningful per-language structural correctness.

## Live surface behavior

- Changes ignores Structural selection whenever the existing split layout is active and continues to render the legacy split body.
- Structural rendering bypasses DiffViewer's vertical and horizontal ScrollViews. This is especially visible for max-height tool cards and full-height File History; Structural always wraps and can overflow or clip instead of owning the same scroll behavior as Line.
- Unsupported or invalid Structural input silently mounts Line. The computed fallback message is only converted to a disabled toggle state and is not shown to the user.
- Inline Structural replacements render without syntax tokens and use app status colors for explicit old/new fragments, contrary to the confirmed syntax-palette ownership requirement.
- Refine creates one DiffViewer per hunk. Each instance reparses the same complete before/after file snapshots several times, multiplying main-thread cost by hunk count.
- Agent edit cards pass tool `oldString` / `newString` fragments as though they were complete file snapshots. Parseable fragments can therefore be incorrectly advertised as parser-safe Structural source.

## Measured performance

Read-only Node measurements against the production pure planner on this checkout:

| Changed lines per side | Total diff lines | Structural plan time |
| ---------------------: | ---------------: | -------------------: |
|                    100 |              200 |              43.0 ms |
|                    250 |              500 |             169.2 ms |
|                    500 |            1,000 |             633.2 ms |
|                  1,000 |            2,000 |           2,918.4 ms |

The 2,000-line case is accepted by the current hard cap and added about 53.8 MiB of heap in that run, before React rendering. A separate 5,000-line valid TypeScript snapshot with a tiny two-line hunk averaged about 170 ms per availability-plus-plan pass; 25 repeated hunk instances took about 4.25 seconds.

No enforced latency or memory thresholds were found.

## Passing checks

- Structural corpus: 4 files, 93 tests passed; Vitest reported 285 ms test execution.
- App, server, and highlight workspace typechecks passed.
- Targeted lint on 15 diff/protocol/highlight files passed with no warnings.
- Server diff-highlighter: 28 tests passed.
- Server Git file history: 19 tests passed.
- Focused checkout snapshot/highlighting test passed.

## Timeline

- time: "2026-08-13T08:02:09.086Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience","language-support-grows-with-structural-diff","diff-visual-language-is-syntax-palette-owned","new-diff-selection-is-capability-gated"]
- time: "2026-08-13T08:02:09.086Z"
  kind: "evidence"
  summary: "Read-only audit on 2026-08-13 of packages/app/src/utils/diff-document.ts, structural-render-plan.ts, structural corpus and language matrix, DiffViewer and all live consumers; packages/highlight parser registry; protocol ParsedDiffFile; server checkout/history snapshot paths; focused Vitest/typecheck/lint runs; and direct production-function probes/benchmarks. Compared with current Difftastic official parsing and diffing documentation."
