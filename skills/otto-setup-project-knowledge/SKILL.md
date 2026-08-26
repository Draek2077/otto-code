---
name: otto-setup-project-knowledge
description: Initialize and verify Otto's project knowledge store for a project. Use when a user asks to set up, enable, initialize, or prepare project knowledge before seeding it.
---

# Set up Otto project knowledge

Prepare the current repository for durable project knowledge. Setup is intentionally empty: it
creates the storage contract for facts, project charters, and evaluated references but does not
infer or record their contents.

## Workflow

1. Read `docs/project-knowledge.md` if present. Let Otto place the store and never create a parallel
   `BRAIN.md`, `brain/`, database, or hand-maintained knowledge system. The store lives either in
   the repository under `.otto/` or host-local under the daemon's `$OTTO_HOME`, decided by the
   project's Knowledge location setting and the host default behind it. Do not assume, move, or
   hand-create either one.
2. Check the host capability `server_info.features.projectKnowledge`. If it is absent or false,
   tell the user to update the host and stop. Do not create a fallback store.
3. Call `bootstrap_project_knowledge` for the current repository. It is safe to run repeatedly and
   creates `knowledge/index.md`, the root-page skeleton, and canonical locations for factual pages,
   projects, and references as records are introduced, all inside whichever store the project
   resolves to. The sibling `KNOWLEDGE.md` is optional project-specific guidance, not the
   initialization marker; bootstrap preserves it when present.
4. Verify the result by listing or reading the generated files, and by querying project knowledge if
   the tool is available. For a host-local store the files are outside the working tree, so read
   them at the absolute path Otto reports rather than expecting them in the repository.
5. Report exactly what was initialized and recommend `$otto-onboard-project` for evidence-backed
   seeding. Do not claim that setup discovered architecture or decisions.

## Rules

- Do not populate pages during setup.
- Optional `KNOWLEDGE.md` guidance may be edited or removed directly. Do not hand-edit the generated
  index, root pages, or atomic record pages.
- Do not install hooks, rewrite agent configuration, or add dependencies. Otto's daemon capability
  and skills already provide the integration boundary.
- Preserve existing pages and legacy data. Bootstrap may migrate the old JSON source on first read;
  do not delete it manually.
