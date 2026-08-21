# Project knowledge

Project knowledge is repository-owned memory of durable decisions, constraints, requirements, architecture claims, measured findings, project charters, and evaluated references. It is separate from personality memory: a personality remembers how it works; a repository remembers what the team established, what it measured, what it is building, and which outside sources shaped that work. People and team relationships do not belong here.

## Storage and invariant

All Otto project state lives under `.otto/`:

```text
.otto/
  KNOWLEDGE.md
  knowledge/
    index.md
    background.md
    architecture.md
    flow.md
    mindmap.md
    stack.md
    roadmap.md
    decisions/
    constraints/
    requirements/
    architectures/
    findings/
    projects/
    references/
```

`.otto/KNOWLEDGE.md` is optional project-specific guidance, not the store's operating contract or initialization marker. Otto's default behavior is baked into the compact catalog instructions. When the optional file contains project-owned guidance, the catalog points to it and an agent reads it on demand before writing or managing Knowledge; its body is never fixed prompt weight. The generated index and record pages are canonical Markdown, portable and reviewable in Git. Those remain daemon-owned so worktree resolution, validation, provenance, and reindexing stay atomic.

Each atomic page has frontmatter, rich Markdown compiled truth, and an uncapped append-only timeline. Pages use readable kebab-case slugs and `[[wiki links]]` to other atomic pages; root pages use their fixed slugs rather than pretending to be atomic wiki targets. Compiled truth can carry headings, lists, tables, code fences, diagrams, and links. A truth update requires a reason. Otto writes the truth and its timeline reason in one operation. Status transitions and evidence also enter the timeline. This makes a truth change without rationale impossible through Otto.

The earlier unshipped `.otto/project-knowledge.json` foundation migrates on first read into Markdown pages. A daemon-written marker prevents that source from being imported again after canonical pages are deliberately deleted. Pre-release Markdown pages also migrate on first read: UUID ids become deterministic human slugs, current wiki links are rewritten, legacy evidence enters the timeline, and historical timeline text remains untouched. The JSON is retained as a non-authoritative migration source and is never rewritten.

## Review, delivery, and reference lifecycles

- `proposed` is a review-only draft.
- `confirmed` is active project knowledge and appears in normal search.
- `superseded` remains Git-visible history and is excluded from normal search.

Review status applies to every page and answers one question: should Otto treat the page as trusted current knowledge? It does not describe implementation progress. A confirmed project charter can still be only a charter, in build, partial, blocked, complete, retained as reference material, deferred, or cancelled.

Project pages add a delivery status and may add structured progress as `completed`, `total`, and `unit`. Otto derives the percentage instead of storing a second value that can drift. The management UI reports project counts, active and completed projects, and aggregate measured progress. A progress update requires a reason and appends it to the page timeline.

Reference pages add an evaluation: unevaluated, read, adopted, rejected, or dependency. They may carry a canonical source URL. The page body records what the source says and how it affected the project. Rejected references are useful knowledge because they stop future agents from repeating discarded research. Evaluation and URL changes require a reason and append to the timeline.

Finding pages use the same record shape as decisions, constraints, requirements, and architecture claims. A finding captures something noticed or discovered that may matter later, before the team understands its cause or has a reason to act on it. It does not imply an architectural decision, remediation plan, or resolved analysis. Findings stay discoverable alongside other Knowledge records when relevant work begins. The review-only `ProjectKnowledgeHealth` diagnostic is deliberately distinct from a persisted `finding` record.

This separation prevents two dangerous ambiguities: confirming that a charter is accurate never marks its work complete, and adopting a source never bypasses normal review of the reference page.

## Discovery and retrieval

At every new, resumed, or refreshed chat session, Otto reads the repository store and injects a compact catalog containing the baked-in capture policy, the six root pages, and active atomic pages. The catalog carries titles and links, not full page bodies. It adds a short pointer to `.otto/KNOWLEDGE.md` only when that file contains project-specific guidance rather than a known generated compatibility entry. Optional guidance and rich page bodies stay pull-on-demand. Only the injected catalog weight is reported as `projectKnowledgeTokens` in Context Management. Agents read relevant rich pages on demand before broad repository searches, then verify implementation facts against current code.

The baked-in policy carries the standing capture rule: capture is deliberately deferred while work is in motion. Agents do not write Project Knowledge after each query, hypothesis, experiment, attempted fix, or intermediate implementation. Those are working state, and most should disappear when the solution converges.

At the end of an effort, after the requested outcome has been verified and before the final handoff, the agent performs one reconciliation pass. It reviews relevant active and proposed pages, updates the best existing record when possible, and creates a page only for a stable, evidence-backed outcome that will matter beyond the current task. Qualifying outcomes include explicit decisions and requirements, verified constraints or architecture, measured findings, actual charter progress, and references whose project impact is known. If the effort produced no durable outcome, the correct reconciliation is no write. A direct request to create, ingest, review, or revise Project Knowledge is itself the effort and may write as part of that workflow.

This timing rule lets development proceed through mistakes and abandoned approaches without fragmenting the durable record. A failed experiment is captured only when the failure itself is a verified, reusable finding. New pages remain inactive until explicit human confirmation. Delivery and reference metadata changes do not alter review status.

This is the practical distinction between discovery and context injection: discovery itself is a small automatic injection, while the potentially large page content stays conditional. The workspace list RPC follows the same rule: it returns lightweight catalog records with a statement digest, and the reader fetches full Markdown and timeline only for the selected page. Draft and superseded pages do not enter the catalog or normal agent retrieval.

## Bootstrap and management

`bootstrap_project_knowledge` creates all six writable root-page skeletons and the generated index. The index is the current initialization marker, so Project Knowledge continues to work when `.otto/KNOWLEDGE.md` is absent. During the compatibility window, a new store also receives a tiny entry file for older daemons that still use it as their marker; current Otto ignores that generated content and does not recreate the file if a project removes it later. Project-specific contents are always preserved. Bootstrap does not invent facts. Project onboarding inspects code, official documentation, tests, and Git history, then fills background, architecture, flow, mindmap, stack, and roadmap with evidence-backed Markdown before proposing atomic pages.

**Manage knowledge** is a capability-gated workspace tab with Knowledge, Projects, and References modes. Knowledge shows the six project-map roots and factual pages, including findings. Projects creates and reviews charters, displays status and completion metrics, and updates delivery with a reason. References records source URLs and adoption or rejection. All modes render the canonical Markdown page and its complete timeline, support explicit review status, and require a reason to change current truth. The panel never writes raw Markdown directly.

The same tools and UI work in any repository. A project no longer needs an Otto-specific `projects/` ledger or a monolithic `docs/references.md` to reproduce the practice. Existing repositories migrate by creating Knowledge pages through daemon APIs, verifying page counts and contents, and only then retiring old files or instructions. Import-first prevents a partial migration from destroying the source record.

## Agent tools

- `bootstrap_project_knowledge` scaffolds the knowledge tree and generated index without requiring a project policy file.
- `list_project_knowledge` lists active atomic pages and the six roots.
- `read_project_knowledge` reads one active rich page and its complete timeline.
- `query_project_knowledge` searches active compiled truth, evidence, tags, and timeline evidence.
- `read_project_knowledge_root` and `update_project_knowledge_root` operate on the six rich project-map pages.
- `lint_project_knowledge_links` reports unresolved wiki links without rewriting history.
- `record_project_knowledge` creates a human-slugged Markdown page.
- `migrate_legacy_project_findings` imports dated reports from a legacy report directory as first-class finding records without deleting the source. Nothing in this repository still needs it; it exists for projects being onboarded that carry one.
- `record_project_charter` creates a project page with independent delivery state and optional structured progress.
- `update_project_delivery` changes delivery state or progress with an atomic timeline reason.
- `record_project_reference` creates an evaluated reference with an optional canonical URL.
- `update_project_reference` changes reference evaluation or URL with an atomic timeline reason.
- `update_project_knowledge_truth` changes current truth with an atomic timeline reason.
- `append_project_knowledge_evidence` adds provenance without changing truth.
- `set_project_knowledge_status` activates, drafts, or supersedes a page with a recorded transition.
- `delete_project_knowledge` permanently removes accidental or junk data only after the user explicitly approves deleting that exact page. It strips deterministic wiki links to the removed page from current truth and project-map pages, but never rewrites historical timeline evidence; valid history is superseded instead.

The workspace-scoped management RPCs remain daemon-owned, so worktrees share one knowledge store. The project-knowledge capability is gated for old clients and daemons.
