# Structural diff corpus

This directory is the fast, source-pair regression corpus for Otto's native
structural diff. It is intentionally small and curated: every pair must carry
a semantic expectation in `structural-diff-fixtures.test.ts`.

## Upstream provenance

The `difftastic/` files are copied from
[`Wilfred/difftastic`](https://github.com/Wilfred/difftastic) at commit
`d8fe43b3ef8ebf55a411af9da708f28048f071cd` (2026-08-13). They are retained
under the upstream MIT license in `difftastic/LICENSE`.

Upstream's terminal render is a reference, not Otto's expected output. Otto
asserts stable review semantics: shared context, replacements, pure additions
and removals, exact moves, and formatting-only changes. The semantic planner
is intentionally conservative. It only calls a move when removed and added
lines are identical, and only calls formatting when the complete changed
source differs by whitespace alone. This keeps the inner loop deterministic
and independent of a Difftastic executable.

Add a fixture only when it captures a real structural-diff question. Preserve
the upstream filename and source text for copied cases. Locally authored cases
live under `otto/` and say why they exist in their test name.

`../../structural-diff-language-matrix.ts` is the companion parser-coverage
matrix. It supplies one valid complete source pair for every extension in the
syntax parser registry, asserts exact extension coverage, parser-safe
Structural eligibility, source reconstruction, and that the planner does not
drop a line. It is a smoke floor, not a substitute for language-specific
semantic cases in this corpus.
