---
name: otto-project-knowledge
description: "Operate Otto's repository-owned project knowledge safely: query pages, manage project charters and delivery, evaluate references, update current truth with reasons, append evidence, and review status. Use when an agent needs to read or change durable project knowledge."
---

# Otto project knowledge operations

Use the daemon-owned project-knowledge tools as the only write path. The canonical store is
Markdown under `.otto/knowledge`, but current truth and its provenance must be changed atomically by
Otto rather than by editing files directly.

## Read

- At task start, consult the automatically injected active-page catalog. Use
  `list_project_knowledge`, `read_project_knowledge`, or `read_project_knowledge_root` for pages
  relevant to the task before broad repository searches.
- Use `query_project_knowledge` when the relevant page is not obvious. Normal reads return only
  confirmed active pages. Include inactive pages only for an explicit knowledge review.
- Read compiled truth, evidence, tags, and the complete timeline. Treat `superseded` pages as
  history, not current guidance.
- `.otto/KNOWLEDGE.md` is optional, on-demand project guidance. If it exists with project-specific
  content, read it before writing or managing Knowledge. Do not load it merely because a task reads
  existing Knowledge. Unlike record pages and the generated index, the project may edit or remove
  this file directly; baked-in behavior applies when it is absent.

## Write

- Use `record_project_knowledge` for a new fact. Include one of `decision`, `constraint`,
  `requirement`, or `architecture`, a precise title, rich Markdown compiled truth, evidence, and
  useful tags. Use a readable kebab-case id when a specific human slug matters. New pages start as
  `proposed`.
- Use `record_project_charter` for a durable initiative. Include rich Markdown outcomes, scope,
  constraints, and acceptance criteria. Review status says whether the charter is trusted;
  delivery status independently says whether it is chartered, in build, partial, blocked,
  complete, retained as reference material, deferred, or cancelled.
- Use `update_project_delivery` for a delivery or structured progress change. Supply a reason.
  Progress is completed, total, and unit; Otto derives percentage.
- Use `record_project_reference` for an external source and its project-specific evaluation. Record
  adopted and rejected sources. Use `update_project_reference` when disposition or URL changes.
- Use `update_project_knowledge_root` to maintain background, architecture, flow, mindmap, stack,
  and roadmap. Preserve rich Markdown and link atomic pages with `[[wiki links]]`.
- Use `update_project_knowledge_truth` only when the current understanding changes. Supply a
  concrete reason and preserve the expected-update timestamp to detect stale edits.
- Use `append_project_knowledge_evidence` when new provenance strengthens a page without changing
  its current truth.
- Use `set_project_knowledge_status` to confirm or supersede only after explicit user agreement.
  A proposal is not authorization to confirm it.
- During exploration, trial and error, and implementation, keep tentative conclusions in the task
  context or `.tmp/`; do not turn each query, hypothesis, attempted fix, or abandoned approach into
  Project Knowledge.
- At the end of the effort, after the requested outcome is verified and before the final handoff,
  perform one knowledge reconciliation pass. An effort ends when the requested work is complete or a
  stable result is being handed off, not at the end of every assistant turn.
- In that pass, review the relevant active pages and any related proposed pages. Update the best
  existing page, charter delivery record, or reference instead of creating an overlapping page.
- Record only stable, evidence-backed outcomes that will matter beyond the current task: an explicit
  decision or requirement, a verified constraint or architecture claim, a measured finding, actual
  charter progress, or a reference whose project impact is now known. If the effort produced no such
  outcome, write nothing.
- A direct request to create, ingest, review, or revise Project Knowledge may write during the task;
  it is itself the effort being performed. Never turn a proactive proposal into confirmed truth
  without agreement.
- Use `delete_project_knowledge` only for accidental or junk pages after the user explicitly approves
  deleting that exact page. Supersede valid historical knowledge instead.
- Run `lint_project_knowledge_links` after changing links. Fix current truth or roots, never old
  timeline entries.

## Review discipline

- Prefer one durable page over several overlapping pages.
- Record facts that are difficult to reconstruct from code and likely to matter in six months.
- Name concrete files, tests, documentation, commits, or user statements as evidence.
- Separate observed facts from recommendations and label uncertainty.
- Do not preserve failed experiments merely because they happened. Keep one only when the failure is
  itself a verified, reusable finding that changes future work.
- Keep review status, delivery status, and reference disposition distinct.
- Do not record people or team relationships; that belongs to team or personality memory.
- Never store secrets, credentials, temporary TODOs, routine implementation details, or copied source.
- If project knowledge is unavailable on the host, report the capability gap. Do not fall back to a
  second storage format.
