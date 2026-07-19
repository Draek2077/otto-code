# archdocs — Otto architecture documentation site

Docs-as-code architecture documentation: AsciiDoc pages with embedded Mermaid
diagrams, built to a self-contained static site (no network, no external services —
mermaid renders client-side from a vendored bundle).

## Use

```bash
npm run archdocs:build   # pages/*.adoc -> dist/*.html
npm run archdocs:serve   # build + serve on http://127.0.0.1:4400
```

Or start it as a preview server (entry `archdocs` in `.claude/launch.json`).

## Layout

- `pages/` — the documentation set, numerically ordered; `00-index.adoc` is the
  master table of contents.
- `templates/` — skeletons for new documents (system overview, process flow, ERD,
  technical design). Copy one; keep every section. Consistent structure is what
  makes LLM-authored docs reviewable by humans.
- `build.mjs` / `serve.mjs` / `theme.css` — the toolchain. `[mermaid]` listing
  blocks in AsciiDoc pass through as `<pre class="mermaid">` and render in the
  browser (light/dark aware).
- `dist/` — build output, not committed.

## Authoring rules

1. **Node budgets are hard limits.** Flowcharts ≤ 15–20 nodes, sequences ≤ 6
   participants, ERDs ≤ 10–12 entities. Overflow means the subject needs a child
   page, not a bigger diagram.
2. **Every diagram states its why.** New diagrams are proposed through
   `pages/04-diagram-catalog.adoc` with the question they answer. No why, no diagram.
3. **Invariants are the point.** System pages end with numbered, checkable
   invariants and a change/audit checklist — that is what makes these docs an audit
   instrument instead of a description.
4. **No line numbers, no full schemas.** Reference files by path; schemas live in
   code (`packages/protocol`). This set documents boundaries and flows, not copies
   of the source.
5. **`docs/` still owns subsystem gotchas.** This set is the layer above it. When
   they disagree: code wins, then `docs/`, then archdocs — and the disagreement is a
   bug to fix here.
