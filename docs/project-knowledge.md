# Project knowledge

Project knowledge is a project's memory of durable decisions, constraints, requirements, architecture claims, measured findings, project charters, and evaluated references. It is separate from personality memory: a personality remembers how it works; a project remembers what the team established, what it measured, what it is building, and which outside sources shaped that work. People and team relationships do not belong here.

## Storage and invariant

A project's knowledge store holds the same tree wherever it lives:

```text
<store>/
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

### Where the store lives

Two locations, one layout.

- **Repository**, at `.otto/` in the working tree. The store is versioned, shared with the team, and reviewable in a pull request. This is the default and the historical behavior.
- **Host**, at `$OTTO_HOME/project-knowledge/<project>/` on the daemon's machine, with a `project.json` marker naming the project it belongs to. Nothing appears in the working tree, so a repository never has to gitignore anything to use Knowledge. The trade is real: a host store is not versioned, not shared, and not reviewable.

The effective location resolves in a fixed order:

1. The project's own setting, in Project Settings under **Knowledge**.
2. A repository store that already exists on disk.
3. The host default, in host Settings under **Workspaces**.

Rule 2 is why changing the host default is safe. A repository whose `.otto/knowledge` is checked in keeps using it, so flipping the default never appears to erase a teammate's knowledge; it only decides where projects that have no store yet will start. Switching a project's own setting asks whether to carry the existing pages across, and never moves them silently, because a repository-to-host move stages a deletion in the user's working tree.

Otto worktrees share their main checkout's store in both locations, because root resolution collapses a worktree to its main repository root before the store is resolved.

Requires host capability `projectKnowledgeStoreLocation` (v0.8.18). A client on an older host sees no location control and every project stays in its repository.

### The entry point

The optional `KNOWLEDGE.md` beside the `knowledge/` tree is project-specific guidance, not the store's operating contract or initialization marker. Otto's default behavior is baked into the compact catalog instructions. When the optional file contains project-owned guidance, the catalog points to it and an agent reads it on demand before writing or managing Knowledge; its body is never fixed prompt weight. The generated index and record pages are canonical Markdown, portable in either location and reviewable in Git when the store is in the repository. Those remain daemon-owned so store and worktree resolution, validation, provenance, and reindexing stay atomic.

Each atomic page has frontmatter, rich Markdown compiled truth, and an uncapped append-only timeline. Pages use readable kebab-case slugs and `[[wiki links]]` to other atomic pages; root pages use their fixed slugs rather than pretending to be atomic wiki targets. Compiled truth can carry headings, lists, tables, code fences, diagrams, and links. A truth update requires a reason. Otto writes the truth and its timeline reason in one operation; changing a confirmed page's truth also returns it to `proposed` in that same transaction. Status transitions and evidence also enter the timeline. This makes a truth change without rationale impossible through Otto.

The earlier unshipped `.otto/project-knowledge.json` foundation, always a repository file, migrates on first read into Markdown pages. A daemon-written marker prevents that source from being imported again after canonical pages are deliberately deleted. Pre-release Markdown pages also migrate on first read: UUID ids become deterministic human slugs, current wiki links are rewritten, legacy evidence enters the timeline, and historical timeline text remains untouched. The JSON is retained as a non-authoritative migration source and is never rewritten.

## Review, delivery, and reference lifecycles

- `proposed` is a review-only draft.
- `confirmed` is active project knowledge and appears in normal search.
- `superseded` remains Git-visible history and is excluded from normal search.

Review status applies to every page and answers one question: should Otto treat the page as trusted current knowledge? It does not describe implementation progress. A confirmed project charter can still be only a charter, in build, partial, blocked, complete, retained as reference material, deferred, or cancelled.

Project pages add a delivery status and may add structured progress as `completed`, `total`, and `unit`. Otto derives the percentage instead of storing a second value that can drift. The management UI reports project counts, active and completed projects, and aggregate measured progress. A progress update requires a reason and appends it to the page timeline.

Reference pages add an evaluation: unevaluated, read, adopted, rejected, or dependency. They may carry a canonical source URL. The page body records what the source says and how it affected the project. Rejected references are useful knowledge because they stop future agents from repeating discarded research. Evaluation and URL changes require a reason and append to the timeline.

Finding pages use the same record shape as decisions, constraints, requirements, and architecture claims. A finding captures something noticed or discovered that may matter later, before the team understands its cause or has a reason to act on it. It does not imply an architectural decision, remediation plan, or resolved analysis. Findings stay discoverable alongside other Knowledge records when relevant work begins. The review-only `ProjectKnowledgeHealth` diagnostic is deliberately distinct from a persisted `finding` record.

This separation prevents two dangerous ambiguities: confirming that a charter is accurate never marks its work complete, and adopting a source never bypasses normal review of the reference page.

## Article refinement

Project Knowledge articles can be reviewed in their rendered Markdown view. A text selection creates an in-memory, source-backed review note; a mapped fenced block, including Mermaid, can be reviewed as one whole block. Notes are temporary to the open article and remain editable until **Refine with AI** is run. The renderer uses the selection only to locate an exact Markdown source range, so identical prose elsewhere in the article is never a candidate for the same replacement.

Direct replacements are applied first, from the end of the source toward the beginning. Refinements then go to the dedicated writer as independent source-scoped requests. The writer returns one replacement per range, and Otto splices only those ranges into an inert proposal. For atomic records, both **Current understanding** and **Evidence** are human-authored review fields and can carry any number of notes in one session. The Project Knowledge canvas groups the proposal into independently keepable or droppable hunks while retaining plain, non-toggleable document context between them; refused hunks remain visible but dimmed. The pinned document toolbar owns proposal actions: discard, keep or drop all, the shared **Wrap long lines** preference, and apply. Applying writes only the kept changes atomically. A confirmed atomic record becomes proposed where required, while **Discard** changes nothing. Generated Tags, Timeline, Review signals, and operational summaries remain outside the editable article body and cannot be annotated.

This requires host capability `projectKnowledgeAnchoredRefinement` (v0.8.21). A client connected to an older daemon does not expose the review commands.

## Discovery and retrieval

At every new, resumed, or refreshed chat session, Otto reads the project's store and injects a compact catalog containing the baked-in capture policy, the six root pages, and active atomic pages. The catalog carries titles and links, not full page bodies. It adds a short pointer to the store's `KNOWLEDGE.md` only when that file contains project-specific guidance rather than a known generated compatibility entry, and names the path the store actually resolves to so the pointer is openable in either location. Optional guidance and rich page bodies stay pull-on-demand. Only the injected catalog weight is reported as `projectKnowledgeTokens` in Context Management. Agents read relevant rich pages on demand before broad repository searches, then verify implementation facts against current code.

The baked-in policy carries the standing capture rule: capture is deliberately deferred while work is in motion. Agents do not write Project Knowledge after each query, hypothesis, experiment, attempted fix, or intermediate implementation. Those are working state, and most should disappear when the solution converges.

At the end of an effort, after the requested outcome has been verified and before the final handoff, the agent performs one reconciliation pass. It reviews relevant active and proposed pages, updates the best existing record when possible, and creates a page only for a stable, evidence-backed outcome that will matter beyond the current task. Qualifying outcomes include explicit decisions and requirements, verified constraints or architecture, measured findings, actual charter progress, and references whose project impact is known. If the effort produced no durable outcome, the correct reconciliation is no write. A direct request to create, ingest, review, or revise Project Knowledge is itself the effort and may write as part of that workflow.

This timing rule lets development proceed through mistakes and abandoned approaches without fragmenting the durable record. A failed experiment is captured only when the failure itself is a verified, reusable finding. New pages remain inactive until explicit human confirmation. Delivery and reference metadata changes do not alter review status.

This is the practical distinction between discovery and context injection: discovery itself is a small automatic injection, while the potentially large page content stays conditional. The workspace list RPC follows the same rule: it returns lightweight catalog records with a statement digest, and the reader fetches full Markdown and timeline only for the selected page. Draft and superseded pages do not enter the catalog or normal agent retrieval.

## Bootstrap and management

`bootstrap_project_knowledge` creates all six writable root pages and the generated index. For an uninitialized page, or the older ceremonial placeholder, it creates a clearly marked draft from directly observable repository evidence: the root manifest, README, documentation index/files, workspace patterns, scripts, and top-level directories. It reports missing or malformed evidence rather than inventing an architectural claim, and never overwrites a generated evidence draft or a person’s root document. The index is the current initialization marker, so Project Knowledge continues to work when `KNOWLEDGE.md` is absent. During the compatibility window, a new store also receives a tiny entry file for older daemons that still use it as their marker; current Otto ignores that generated content and does not recreate the file if a project removes it later. Project-specific contents are always preserved. Project onboarding can then inspect code, official documentation, tests, and Git history to refine the six drafts before proposing atomic pages.

**Manage knowledge** is a capability-gated workspace tab with Knowledge, Projects, and References modes. Knowledge shows the six project-map roots and factual pages, including findings. Projects creates and reviews charters, displays status and completion metrics, and updates delivery with a reason. References records source URLs and adoption or rejection. All modes render the canonical Markdown page and its complete timeline, support explicit review status, and require a reason to change current truth. Existing records expose **Edit tags**, with scoped suggestions and an atomic metadata save that leaves the article's current truth and review status untouched. This action requires host capability `projectKnowledgeTagEditing` (v0.8.21), so an older daemon simply omits it. Current truth and new record bodies use the same live-formatted Markdown editor as the File Editor, with a one-click raw-source view.

### Reviewed AI refinement

On a supported desktop host, a reader selects a phrase in a rendered Knowledge article, then uses the context menu to add temporary feedback. The phrase remains highlighted with a scroll-bound marker that opens its editor. Feedback is either **Replace**, whose replacement text is applied before the model sees the article and remains verbatim, or **Refine**, an instruction for improving the selected passage. The two kinds use distinct semantic annotation treatments as well as their labels. Feedback is local to that review session and is consumed when the Project Knowledge canvas opens its in-place proposal; it is neither a durable comment thread nor part of the Knowledge record.

The dedicated writer runs two passes: deterministic replacements, then the remaining refinements. The resulting proposal is base-pinned and is either applied or rejected before anything is written. Applying an atomic record updates its human-authored current understanding and, when reviewed, evidence in the same daemon-owned conditional transaction, then moves a previously confirmed record back to `proposed` with a timeline entry. It therefore leaves normal Knowledge retrieval until a person confirms the revision. The six root pages join this first release: they have no review lifecycle, so their stored body digest refuses an overwrite if the page changed during review. Their existing `updated` frontmatter and repository Git history remain the audit boundary. A successful apply refreshes the source Knowledge article so review can continue. This path requires `server_info.features.projectKnowledgeAnchoredRefinement` (v0.8.21); there is no old-host fallback.

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
