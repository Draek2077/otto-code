---
id: "reference-confluence-cloud-rest-api"
kind: "reference"
title: "Confluence Cloud REST API"
status: "proposed"
tags: ["confluence","atlassian","rest-api","knowledge","integrations"]
reference_disposition: "read"
source_url: "https://developer.atlassian.com/cloud/confluence/rest/v2/"
created_at: "2026-08-21T04:46:44.045Z"
updated_at: "2026-08-21T04:46:44.045Z"
---
# Confluence Cloud REST API

<!-- compiled_truth -->

Confluence Cloud's REST API, evaluated as the surface for linking an external knowledge base into Otto for search and reading. Nothing in Otto is built on it yet. This page records what a client would have to accept.

## It is a two-version client, not a v2 client

The v1 to v2 migration stalled with holes, and a working integration has to straddle both. Verified gaps at audit time:

| Operation | API version | Path |
| --- | --- | --- |
| Read, create, update, delete pages | v2 | `/wiki/api/v2/pages` |
| List spaces, list pages in a space | v2 | `/wiki/api/v2/spaces` |
| **Attachment upload** | **v1 only** | `/wiki/rest/api/content/{id}/child/attachment` |
| **Labels (add, remove, list)** | **v1 only** | `/wiki/rest/api/content/{id}/label` |
| **Space creation** | **v1 only** | `/wiki/rest/api/space` |

There is no v2 attachment-upload endpoint and labels are not exposed on v2. Anyone planning a clean v2-only client should expect to discover this partway through and should plan the hybrid up front.

## Updates are full-resource with optimistic concurrency

A v2 page update is a `PUT` carrying the **complete** resource, not a patch, and it must include `version` set to the current version plus one. The version number is an optimistic concurrency token: a stale value is rejected rather than silently overwriting a concurrent edit.

So the write path is always get, modify, put, and a conflict is a real error the caller has to handle by re-reading and re-applying. For an agent this is a good property, because it makes lost-update failures loud instead of invisible.

## Bodies are storage-format XHTML

Page content is Confluence storage format: XHTML carrying Confluence-specific macro elements (`ac:` and `ri:` namespaces). It is not HTML and it is not Markdown. Referencing an uploaded attachment inside a body, for instance, requires emitting a specific macro element rather than an `img` tag.

This is the same class of problem as Jira's ADF and needs the same answer: one converter, owned, tested. Two different Atlassian products, two different structured body formats, no shared code between them.

## The round-trip document format is the idea worth stealing

The audited corpus uses one file shape across three operations: read writes frontmatter (id, title, space, parent, version, status) followed by the storage-format body; update reads exactly that shape back and posts it with the version incremented; create accepts the same shape minus id and version.

Three operations, one document format, editable in between. For an agent surface this is meaningfully better than a read tool and a write tool with unrelated schemas, because the artifact the model read is literally the artifact it edits and hands back, and the concurrency token rides along in the document rather than needing to be threaded separately.

## Destructive operations are tiered

The audited corpus offers archive as the reversible default (a status flip to archived, restorable), trash as opt-in requiring interactive confirmation and refusing when non-interactive, and no permanent-purge path at all, on the reasoning that irreversible destruction should require the vendor's own UI.

That three-tier shape is worth mirroring for any Otto integration that can delete user content, independently of Confluence.

## Relevance to Otto

The pieces that matter for an external knowledge surface are: listing spaces, listing a space's pages as a tree, labels as the cross-cutting tag axis, and page content arriving as a structured document rather than as prose.

This is a genuinely different thing from Otto's project knowledge, which is repository-owned Markdown that Otto writes and controls. A Confluence surface would be remote, read-mostly, and not ours. Folding it into the existing project-knowledge store would be a category error. Treating it as a separate searchable surface is the open design question.

## Timeline

- time: "2026-08-21T04:46:44.045Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","connectors"]
- time: "2026-08-21T04:46:44.045Z"
  kind: "evidence"
  summary: "Audit of a corpus of 41 operator scripts covering Jira, Confluence, and Bitbucket Cloud, performed 2026-08-20. 10 of the scripts target Confluence and between them cover read, create, update, delete, list, move, label, attach, and space creation.\n\nMethod: extracted module docstrings and request paths across the corpus, then read the scripts that documented an API-version fallback to capture the stated reason for each.\n\nEach v1 fallback is documented in the corpus with its reason, in the script that performs it: attachments state that the v2 API has no attachment-upload endpoint; labels state that labels are not exposed on v2; space creation uses v1 as a documented fallback. These were reported by the script authors against a live tenant, not read from vendor documentation, so they are field-verified but tenant-scoped and should be re-checked before being relied on.\n\nThe full-resource PUT plus version-increment behavior is documented in two independent scripts in the corpus (update and move), both of which GET the page including its body before PUTting it back.\n\nNo Otto code currently calls Confluence. Disposition is read rather than adopted for that reason.\n\nSource-specific values (tenant identifier, site origin, space keys, page ids) were deliberately excluded from this page."
