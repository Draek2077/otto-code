---
id: "external-wiki-is-a-second-knowledge-surface"
kind: "finding"
title: "An external wiki is a second knowledge surface, not an extension of project knowledge"
status: "proposed"
tags: ["knowledge","confluence","search","integrations"]
created_at: "2026-08-21T04:48:12.004Z"
updated_at: "2026-08-21T04:48:12.004Z"
---
# An external wiki is a second knowledge surface, not an extension of project knowledge

<!-- compiled_truth -->

Otto's project knowledge is repository-owned Markdown that Otto writes, versions with the code, and controls end to end. A corporate wiki is remote, owned by someone else, edited by people who have never run Otto, and authoritative for things no repository knows: process, product decisions, runbooks, org context.

Treating the second as an extension of the first would be a category error. Project knowledge is a store Otto writes; a wiki is a corpus Otto reads. They differ in ownership, in write path, in freshness guarantees, and in what a stale page means. Folding wiki content into the project-knowledge store would also break the property that makes that store trustworthy, which is that every page in it was recorded by Otto against this repository.

The shape that appears workable instead is a second, read-mostly surface: search across it, read a page, follow its structure, and cite it. Four properties of the source API make that tractable. Spaces and their pages enumerate as a tree. Labels give a cross-cutting tag axis independent of the tree. Page content arrives as a structured document rather than as prose. And a document identity plus version is available cheaply, which is what any caching or staleness check would need.

Open questions, none of them answered: whether search is delegated to the vendor or indexed locally; whether pages are cached at all, and if so how staleness is decided; how a wiki citation is distinguished from a project-knowledge citation at the point the model uses it; and whether writing back is ever in scope or whether read-only is the permanent boundary. Read-only is the safer starting position and does not foreclose the other.

This is recorded as a direction worth thinking about, not as a plan. Nothing has been designed and nothing has been built.

## Timeline

- time: "2026-08-21T04:48:12.004Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","reference-confluence-cloud-rest-api","connectors"]
- time: "2026-08-21T04:48:12.004Z"
  kind: "evidence"
  summary: "Raised by the user on 2026-08-20 while filtering an audit of a 41-script operator corpus: a wiki could be a good way to link knowledge bases into Otto and allow knowledge to be searched, as something distinct from project knowledge.\n\nThe four enabling API properties are drawn from the Confluence Cloud REST API reference page recorded in the same session, which was built from the 10 wiki-targeting scripts in that corpus. Those scripts collectively demonstrate space listing, page-tree listing within a space, label add/remove/list, structured-document read and write, and the version token that rides with each page.\n\nNo design work, no prototype, and no measurement. The open questions listed are open, not rhetorical."
