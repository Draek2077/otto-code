/**
 * The upstream base this fork is currently merged up to.
 *
 * Otto is a fork of Paseo (see docs/upstream-merges.md). These values are
 * surfaced in Settings → About next to the Otto app version so users can tell
 * which upstream fixes are available under the hood.
 *
 * This is the ONLY file that intentionally carries the upstream brand name, and
 * it is deliberately quarantined here for two reasons:
 *   1. It is an Otto-only file that upstream doesn't have, so it never appears
 *      in an upstream merge diff — the rebrand pass (`scripts/rebrand-upstream.pl`,
 *      run over merge-touched files) never rewrites it.
 *   2. The display code and i18n strings reference these constants instead of
 *      the literal name, so a future merge that touches those files can't
 *      silently rebrand the feature.
 *
 * `UPSTREAM_BASE_VERSION` is a hand-maintained constant, NOT derived (git isn't
 * present in the built app). Bump it whenever you ingest a new upstream release
 * — that step is part of the merge playbook in docs/upstream-merges.md, and
 * this path is on that doc's audit exclusion list.
 */
export const UPSTREAM_BASE_NAME = "Paseo";
export const UPSTREAM_BASE_VERSION = "0.1.106";
