---
id: "public-site-pages-share-a-common-frame"
kind: "requirement"
title: "Public site pages share a common frame"
status: "confirmed"
tags: ["website","layout","navigation","marketing"]
created_at: "2026-08-22T15:19:38.987Z"
updated_at: "2026-08-22T15:46:41.516Z"
---
# Public site pages share a common frame

<!-- compiled_truth -->

All public website pages use one shared outer frame for desktop and compact gutters, header placement, and footer alignment. The landing page, agent directory, and public Docs route participate in that frame. Docs retains its documentation-specific navigation and reading layout inside the shared public shell.

`/docs-app` is an intentionally unlinked standalone documentation view for Otto. It keeps the documentation sidebar and rebases internal docs links under `/docs-app`, but omits the public header, footer, logo link, source link, and links back into the marketing site.

The public header and footer order their primary destinations as **Blog, Releases, Downloads, Docs, Support**. The Releases page remains served at `/changelog` so existing links stay valid.

## Timeline

- time: "2026-08-22T15:19:38.987Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-22T15:19:38.987Z"
  kind: "evidence"
  summary: "User-directed and verified in the local website preview on 2026-08-22. Implemented through `packages/website/src/components/site-shell.tsx`, `site-footer.tsx`, `site-header.tsx`, `landing-page.tsx`, `routes/agents.tsx`, and `styles.css`; website formatting, scoped lint, typecheck, and production build passed."
- time: "2026-08-22T15:46:41.516Z"
  kind: "decision"
  summary: "The user asked for the public Docs route to retain the main-site header and navigation while preserving its documentation navigation, and for an unlinked standalone docs view for Otto."
  source: "User request and local preview verification, 2026-08-22."
