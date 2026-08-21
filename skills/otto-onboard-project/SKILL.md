---
name: otto-onboard-project
description: Onboard a repository into Otto project knowledge by bootstrapping the `.otto` Markdown store, researching the codebase, documentation, Git history, active initiatives, and external references, and recording evidence-backed draft pages for review. Use when a user asks to onboard, initialize, seed, or build project knowledge for a new or existing repository.
---

# Otto project onboarding

Build a small, evidence-backed first map of a repository's durable knowledge. Compose
`$otto-setup-project-knowledge` for initialization, `$otto-project-knowledge` for safe operations,
and `$otto-ingest-project-knowledge` when a discrete document, conversation, or research source
needs to be captured. Keep setup and seeding separate: setup creates the empty store; this workflow
researches the project and records proposals that a human can review in Manage knowledge.

## Workflow

1. Read `docs/project-knowledge.md` when it exists. Treat it as the contract for Otto's knowledge
   store. Do not create a parallel `BRAIN.md`, `brain/`, database, or ad-hoc Markdown system.
2. Check whether the repository is already onboarded. Query/list project knowledge if available and
   inspect `.otto/KNOWLEDGE.md` and `.otto/knowledge/` through normal file-reading tools. Preserve
   existing pages and never duplicate a fact that already has a current page.
3. Call `bootstrap_project_knowledge` for the current repository. This operation is idempotent and
   creates the root-page skeleton and generated index. It preserves optional project-specific
   `KNOWLEDGE.md` guidance and does not discover facts.
4. Gather evidence before writing proposals. Inspect, as applicable:
   - the root README and package manifests;
   - entry points, major directories, configuration, CI, and deployment files;
   - project documentation and contributor guidance;
   - existing project charters, initiative ledgers, and reference bibliographies;
   - recent and foundational `git log` entries, including important reverts or migrations;
   - tests that demonstrate behavior or compatibility requirements.
5. Synthesize only durable facts that are hard to reconstruct from code alone and likely to matter
   in six months. Prefer a few strong pages over a page for every implementation detail. Classify
   each proposal as `architecture`, `decision`, `constraint`, or `requirement`.
6. Populate all six project-map roots with `update_project_knowledge_root`: background,
   architecture, flow, mindmap, stack, and roadmap. Use rich Markdown and `[[wiki links]]` only to
   the atomic pages planned in the next step; refer to roots by their fixed slugs. A root may state that evidence is not yet available, but
   onboarding must not leave the generated placeholder in place.
7. Record each proposal with `record_project_knowledge`, including:
   - a readable kebab-case id;
   - a precise title;
   - a concise current-truth statement;
   - evidence naming concrete files, tests, docs, commits, or user decisions;
   - useful tags such as `architecture`, `compatibility`, `workflow`, or `security`.
     Leave new pages `proposed`; never confirm them on the user's behalf.
     Record durable initiatives with `record_project_charter`, including delivery state and only
     evidence-backed progress. Record important outside sources with `record_project_reference`,
     including URL, evaluation, and exactly how the source shaped or failed to shape the project.
8. Run `lint_project_knowledge_links`, then check for obvious overlap and stale signals using the returned knowledge view. Merge or skip
   duplicate proposals rather than creating competing pages.
9. Report what was created, what evidence supports it, what remains uncertain, and how the user can
   review or confirm the proposals in Manage knowledge. Mention `.otto/KNOWLEDGE.md` and the page
   paths so the Markdown remains discoverable in Git.

## Greenfield projects

If there is little or no code, do not invent architecture. Ask a short interview covering the
project's purpose, users, runtime, persistence, deployment target, non-negotiable constraints, and
the first milestone. Record only answers the user explicitly confirms, as proposed pages.

## Safety and review rules

- Never claim a fact from an unverified convention or an agent guess.
- Separate observed facts from recommendations. Recommendations belong in the proposal wording and
  must be clearly labeled.
- Optional `KNOWLEDGE.md` guidance may be edited or removed directly. Do not hand-edit the generated
  index, root pages, or atomic record pages; use Otto's project-knowledge tools so current truth and
  provenance remain atomic.
- Do not confirm or supersede pages without explicit user agreement.
- Do not add routine coding details, temporary TODOs, secrets, credentials, or copied source code.
- Do not create a second project ledger or references file. Import existing sources through daemon
  tools, verify parity, then recommend retiring the old files or instructions.
- Leave people and team relationships to team or personality memory.
- If the daemon lacks the project-knowledge capability, explain that the host must be updated; do
  not create a degraded fallback store.
