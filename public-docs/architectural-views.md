---
title: Architectural Views
description: Create and review interactive diagrams from project Knowledge.
nav: Architectural Views
order: 34
category: Project tools
---

# Architectural Views

Open **Architectural Views**, choose the host and project, then select a View or
create a **New View**. You can also open Views from a Knowledge article or the
workspace Command Center. Architecture, workflow, sequence, dataflow and lifecycle
diagrams use the same viewer.

Choose Knowledge sources and create a draft. A new starter is unpublished. You
can edit its JSON source directly, or choose a workspace and a ready model under
**Author with a chat**. Otto opens a normal chat with its draft preview beside it.
The model reads the linked Knowledge and validates changes in that same draft.
It cannot publish for you. On compact screens, switch between **Chat** and **View**.

Review the preview and choose **Publish** when the saved draft is ready. **Update
View** starts a draft based on the current publication. Previous revisions remain
available. **Discard** retires a draft; **Remove** removes a publication from the
active library while retaining its history. Neither deletes its Knowledge or chat.

If another editor changes a draft, Otto keeps your local edits and asks you to
review the saved source. A failed or disconnected write may have completed: inspect
its outcome before saving again. **Review saved draft** explicitly replaces local
edits after confirmation. If the saved draft is unavailable, the recovery view
lets you copy local source before clearing it.

The toolbar provides search, semantic lens, routes, overview map, guide, zoom,
fit and applicable motion controls. On web and Desktop, **Export diagram** offers
images and SVG, plus WebM for diagrams with motion. Mobile supports the interactive
viewer; capture exports use a web or Desktop client.

A stale-source notice means linked Knowledge changed since the specification was
saved. It does not automatically rewrite the diagram or publish an update.

The CLI exposes the same library, draft, authoring and review operations through
`otto architectural-view --help` or `otto view --help`. Update an older host if
Otto reports that Architectural Views are unavailable.
