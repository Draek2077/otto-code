---
name: otto-ingest-project-knowledge
description: Convert a conversation, document, decision record, or research result into evidence-backed Otto project knowledge proposals. Use when a user asks to capture, ingest, remember, or preserve durable project information.
---

# Ingest project knowledge

Turn an external evidence source into small, reviewable project-knowledge proposals. This skill is
for focused ingestion after setup or onboarding, not for dumping an entire document into the
repository.

## Workflow

1. Identify the source and its authority: user-confirmed decision, project document, measured test,
   Git change, or external research. If the source is ambiguous or untrusted, ask before recording.
2. Read `docs/project-knowledge.md` and query existing knowledge. Avoid creating a duplicate or
   weakening a confirmed page.
3. Extract only durable claims. Split unrelated claims into separate pages and classify factual
   knowledge as `decision`, `constraint`, `requirement`, or `architecture`. Treat a durable
   initiative as a project charter and an outside source with project relevance as a reference.
4. For each candidate, choose a readable kebab-case id and write focused rich Markdown compiled
   truth plus an evidence note that identifies the source. Use `[[wiki links]]` for meaningful
   relationships. Preserve relevant alternatives, rationale, and uncertainty in the evidence
   rather than presenting inference as fact.
5. Call `record_project_knowledge` for factual candidates, `record_project_charter` for initiatives,
   and `record_project_reference` for sources, leaving new pages `proposed`. For a claim that
   updates an existing page, use `update_project_knowledge_truth` with a reason instead of creating
   a second page. Use `append_project_knowledge_evidence` when the truth is unchanged.
6. Report the proposed pages and ask the user to review them in Manage knowledge. Never confirm or
   supersede pages as part of ingestion unless the user explicitly instructs that exact status
   change.
7. Run `lint_project_knowledge_links` and report unresolved targets.

## Source-specific rules

- **Conversation:** Treat only explicit user decisions and constraints as authoritative. Suggestions
  remain suggestions until the user accepts them.
- **Document:** Summarize; do not copy large passages. Preserve the document path and relevant
  section in the evidence note.
- **Research:** Record the source title/URL and distinguish the source's claim from Otto's local
  inference. Use a reference page and record whether it is unevaluated, read, adopted, rejected, or
  a dependency. External research is context, not automatically a project decision.
- **Legacy charter or ledger:** Preserve the full charter as rich Markdown, map its delivery state,
  and carry over only evidence-backed progress. Import and verify before retiring the old source.
- **Test or benchmark:** Include the command, scope, date if relevant, and result. Do not generalize
  beyond what was measured.
