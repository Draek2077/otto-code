# User Mode - charter

**Status:** charter, 2026-07-31. Nothing built. Status is tracked in
[`projects/README.md`](../README.md), which is authoritative; this file describes the shape and the
phases only.

Otto today assumes its user is a developer and its workspace is a code checkout. The whole surface -
artifacts, the file viewer, Changes, the system prompt every provider builds - is framed around
producing a diff against a repo. But the fork's mission is to bring frontier-model tooling to
**every** user equally, and a large class of users never touch code: they produce **reports, decks,
Word documents, spreadsheets, PDFs, illustrations**. This charter defines **User Mode**: the same
agentic engine, re-skinned around _deliverables_ instead of a repo, so a non-coder can generate,
view, iterate on, save, and publish real documents without ever seeing git, a shell, or a provider
setting.

## What this is

The core realization is that **chat / cowork / code are not different models - they are different
harnesses** (tool surface + execution environment + loop shape) wrapped around the same brain. User
Mode is that same insight applied inside Otto: **not a new engine, a new harness pointed at a
different artifact type.**

In Dev Mode the working directory is a git checkout and the deliverable is a diff. In User Mode the
working directory is a _project folder of documents and assets_, and the deliverable is a report, a
deck, a PDF, or an illustration. Same agent loop, same permission model, same subagents, same
preview-and-verify instinct - a different tool surface, a different notion of "save," and a system
prompt that tells the agent which world it is in.

Five pillars, each independently shippable:

1. **Mode** - a first-class dev/user mode primitive that drives system-prompt construction and
   tool-group gating, provider-agnostic.
2. **Deliverables** - the artifacts subsystem grown from single-HTML-only into editable, iterable,
   multi-format deliverables (report / deck / doc / sheet / illustration / PDF) with export.
3. **Non-code projects & Save** - non-git folders as first-class project workspaces, with a "Save /
   Version / Restore" vocabulary that abstracts git into the simplest possible backup for people who
   have never heard of a commit.
4. **Connectors** - a provider-neutral connector layer (packaged MCP + OAuth) that feeds source data
   in and publishes deliverables out, managed in one easy "Connectors" system in the daemon.
5. **View & verify** - extend the preview/browser-verify loop and the file viewer so the agent
   renders a deliverable, checks it, and shows proof, and the user requests changes in natural
   language.

Dev Mode gets all of this too (a developer can produce a report or wire up a connector); the
difference is which system prompt and tool framing the agent runs under, not which capabilities
exist.

## Scope decision (the authoring-model fork - decided)

The central architectural choice is how a deliverable is _physically stored and authored_:

- **Option A - opaque office files.** Generate `.docx`/`.pptx`/`.xlsx` directly via libraries
  (python-docx, python-pptx). High template fidelity, but the file is an OOXML zip the user cannot
  hand-edit and the agent cannot cleanly re-read or diff. Iteration means regenerating from scratch.
- **Option B - structured intermediate + export.** Author in a text-native model (Markdown / HTML /
  a small document model), which both the agent and a human can edit fluently and Otto can _diff_,
  then **export** to docx/pptx/pdf as the final step.

**Decision: Option B is the spine.** It is the same choice Chat's Artifacts already made (author in
HTML, render it), it preserves the whole existing diff-review architecture (see the Refine loop in
[`../../docs/refine.md`](../../docs/refine.md)), and it makes "revise this report" a bounded,
reviewable edit rather than a full regeneration. Pixel-faithful corporate-template output (Option A)
is a **later, opt-in export backend** for specific formats, not the primary path, and explicitly out
of scope for the first phases.

**Also out of scope for v1:** a WYSIWYG rich-text editor. The codebase grain is strongly
propose-a-reviewed-diff (the in-place "Refactor with AI" was deliberately removed; Refine returns a
diff the user accepts). User Mode extends that grain - edit source, watch it render, or ask in
natural language - rather than fighting it with direct manipulation.

## Relationship to existing charters

This charter carves deliberately against three neighbours so we do not re-litigate their ground:

- **[agent-orchestration](../agent-orchestration/agent-orchestration.md)** owns the _control layer_
  (Teams, typed tasks, recognize → plan → delegate → synthesize) and the "deliverable" vocabulary.
  User Mode **consumes** that vocabulary; it does not redefine how work is invoked. A User-Mode
  project that needs multi-step work uses orchestration as-is.
- **[graph-templates](../graph-templates/graph-templates.md)** owns starter templates
  (research→synthesize, Perform and Teach). User-Mode _deliverable templates_ ("monthly report,"
  "pitch deck") are a **different axis** (document shape, not graph shape) but should reuse the
  template-library plumbing rather than inventing a parallel one.
- **[claude-extensions](../claude-extensions/claude-extensions.md)** owns MCP/plugin management **in
  the Claude provider panel, deliberately Claude-only**. User Mode's Connectors pillar is its
  provider-neutral foil: connectors must fan out across _all_ providers, so this charter owns the
  cross-provider connector layer while claude-extensions keeps the Claude-native surface. Vocabulary
  ("connector," "MCP server") stays aligned between the two.

## Current state (as of 2026-07-31)

Grounded in a read of the subsystems this charter touches.

### Artifacts (the deliverable seed)

- Provider-agnostic and agent-based: generation spawns a normal Otto agent with a dedicated prompt,
  works across every provider, and is capability-gated by `server_info.features.artifacts`
  (`packages/server/src/server/artifact/artifact-service.ts`,
  `packages/server/src/server/agent/tools/otto-tools.ts`). Stored **in the project** at
  `{cwd}/.otto/artifacts/` (docs: `docs/data-model.md` §8).
- **But: single format.** `ArtifactKind = z.enum(["html"])` - every artifact is one self-contained
  HTML file, network-blocked by CSP, no CDN/fonts/remote data
  (`packages/protocol/src/artifacts/types.ts`, `artifact/html-validator.ts`).
- **No export/download anywhere** - no PDF, no "save as," no "open in browser." The only output is
  the in-app rendered view. This is the single biggest gap.
- **No content editing** - `update_artifact` touches metadata only; changing content means a full
  regeneration of the whole HTML. No partial edit, no diff.

### Preview & file viewer (the view/verify seed)

- The browser-verify loop (start server → render in a real Otto tab → screenshot/snapshot/inspect →
  **show proof instead of asking the user to check**) is real, daemon-enforced, and documented as
  load-bearing (`docs/preview.md`; `packages/server/src/server/preview/`,
  `.../browser-tools/`). It maps cleanly onto **web-served** deliverables (an HTML report, an HTML
  deck) with no change. Gaps: non-web formats (docx/pdf) have no render target, and the injected
  workflow prompt only reaches the openai-compat provider.
- The file viewer renders Markdown, AsciiDoc, Mermaid, code (~30 grammars), images, and SVG, with a
  CodeMirror editor + split live-preview (`packages/app/src/components/file-tab-pane.tsx`,
  `file-pane.tsx`). **docx/xlsx/pptx/pdf are not rendered** - they land on a "can't be previewed"
  card.
- **Refine** already is the non-coder "revise this" loop: natural-language instruction → whole-doc
  model pass → **reviewable diff, nothing written until accepted**
  (`packages/app/src/refine/`, `docs/refine.md`). It is **prose-only by design**
  (`refine-scope.ts`: md/adoc/txt/rst/org only).

### Providers, MCP, connectors, auth

- Otto's _own_ tools are a provider-neutral catalog, group-gated (`OTTO_TOOL_GROUPS`), injected per
  provider by the right mechanism - native tool list for openai-compat, internal `/mcp/agents` MCP
  server for the rest (`agent/tools/otto-tools.ts`, `agent/runtime-mcp-config.ts`,
  `agent/agent-manager.ts`). **This is the exact model connectors should imitate.**
- Third-party **MCP servers today are provider-scoped** and only actually consumed by the
  daemon-owned loop (openai-compat, via `providers/openai-compat-mcp.ts`, transports stdio/http/sse,
  config `McpServerConfigSchema` in `packages/protocol/src/provider-config.ts`). There is no
  workspace-level or global connector registry that fans out across providers.
- **No OAuth flow exists anywhere** - every token today is read from a provider CLI's own credential
  file. Connector OAuth is greenfield. Secrets live in `$OTTO_HOME/config.json`; only a narrow set is
  wire-masked (`daemon-config-store.ts` `SECRET_WIRE_PATHS`) - provider `env` keys are notably _not_
  masked, a gap to fix when connector tokens are added.

### Workspaces, save, system prompt

- **Non-git folders are already first-class**: `deriveWorkspaceKind` maps a plain folder to
  `"directory"`/`non_git` with all git fields null - not an error path
  (`packages/server/src/server/workspace-registry-model.ts`). What degrades is everything gated on
  `isGit` (Changes, branches, commit/rollback).
- **"Saving" today is git commit/rollback**, with AI-generated commit messages already routed to a
  Writer personality (`utils/checkout-git.ts`, `session/checkout/git-metadata-generator.ts`). There
  is **no git-free versioning**; rewind/compaction are conversation-scoped, not working-tree
  snapshots.
- **System prompt is per-provider and Otto only appends layers.** The single spawn choke point is
  `AgentManager.prepareSessionConfig` (`agent-manager.ts`), which already stacks
  `applyDaemonAppendSystemPrompt` and `applyPersonalityMemory`. **A `composeModeDirective(mode)`
  layer added here reaches every provider at once.** Caveat: Claude can only _append_ to the
  `claude_code` preset, so User Mode can add guidance to Claude but not remove its coding framing;
  full base-prompt control exists only on openai-compat/opencode.
- **No dev/user "mode" concept exists** - "mode" in the codebase means permission mode only.
  Personalities/roles are the nearest precedent for a spawn-time behavioral layer.

## The design

### Pillar 1 - Mode primitive

A workspace (or an agent) carries a `mode: "dev" | "user"`. It is set at project creation (a non-coder
onboarding path defaults to `user`) and switchable later.

- **System prompt:** add `composeModeDirective(mode)` as a new layer in
  `AgentManager.prepareSessionConfig`, alongside the existing append/memory layers, so it lands for
  every provider through the one choke point. Dev directive is a near-noop (today's behavior); User
  directive steers toward deliverables, the Save vocabulary, and the render-and-show-proof loop, and
  away from raw git/shell talk.
- **Tool gating:** mode selects an `OTTO_TOOL_GROUPS` allowlist. User Mode foregrounds
  artifacts/preview/browser/web/connectors and hides raw terminal/git groups (they still exist under
  the hood for Save; the _agent-facing_ framing changes).
- **Claude caveat is explicit:** on Claude the directive is append-only; the mode still gates tools
  and drives the UI, but the coding-agent base framing remains. openai-compat/opencode get full
  control. This is a documented limitation, not a fallback path.

### Pillar 2 - Deliverables (artifacts v2)

Grow the artifact model from HTML-only to a typed, editable, exportable deliverable:

- **Kinds:** widen `ArtifactKind` beyond `"html"` to a deliverable set. v1 target set (all authored
  as text/HTML per the scope decision): `report`, `slides`, `doc`, `sheet`, `illustration` (SVG). PDF
  is an **export target**, not a kind.
- **Editing & iteration:** replace "regenerate the whole file" with a **Refine-style diff loop
  extended past prose** - the agent proposes a bounded, reviewed edit to the deliverable's source.
  This reuses the Refine architecture (`docs/refine.md`) rather than building a new editor.
- **Export:** add the missing export path - HTML/Markdown source → PDF (print-to-PDF via the existing
  webview is the cheapest first backend), with docx/pptx/xlsx export as later opt-in backends.
- **Templates:** a deliverable-template library ("monthly report," "pitch deck," "one-pager"),
  reusing graph-templates plumbing where possible.
- **Relax the network CSP thoughtfully** for deliverables that legitimately need brand fonts/images
  (a separate, opt-in trust level from the locked-down artifact sandbox).

### Pillar 3 - Non-code projects & Save

- **Projects:** lean on the existing `directory`/`non_git` workspace kind. Add a non-coder project
  creation flow (name a folder, pick a template, done) that never surfaces git vocabulary.
- **Save = the simplest backup.** A "Save a version" / "Restore an earlier version" / "History"
  vocabulary layered over the existing `checkout.git.commit` + `rollbackPaths` primitives and
  AI-generated messages, with an **implicit `git init`** on first save for a `non_git` folder (git
  becomes an invisible backup engine, never a concept the user meets). Remote hosting (GitHub/
  Bitbucket) stays out of scope - this is local backup only.
- Open sub-decision: implicit-git vs a dedicated snapshot store for folders where git is a poor fit
  (huge binaries). Implicit-git is the v1 default.

### Pillar 4 - Connectors

- **A provider-neutral connector layer**, modeled on the Otto tool catalog: connectors are declared
  once, in one place, and the daemon injects each into every provider by that provider's native
  mechanism (native tool list for openai-compat; `/mcp/agents`-style or provider-specific MCP config
  for the rest). This is the cross-provider generalization of what openai-compat's `mcpServers` does
  today, and the foil to claude-extensions' Claude-only panel.
- **Connectors ↔ providers:** a connector is **not** owned by a provider. It is owned by the
  host/workspace and _fanned out_ to whatever provider the user picks - so switching from Claude to a
  local model keeps the same connectors. (Answering the user's core question: connectors are a layer
  _beside_ providers, injected _into_ each, not a property _of_ one.)
- **Auth:** greenfield OAuth (authorization-code/PKCE) plus API-key connectors. Tokens live in a new
  masked section of `config.json` added to `SECRET_WIRE_PATHS`, following the brain/gitHosting
  secret pattern. A "Connectors" settings surface manages add / authorize / revoke.
- **Two directions:** _inbound_ connectors feed source data (analytics, sheets, CRM) into a report;
  _outbound_ connectors publish a finished deliverable (Drive, SharePoint, Notion, email). The
  OAuth-scoped identity is what makes "publish this to my team's Drive" safe.
- **Which connectors first:** to be decided (open question), but the mechanism is format-agnostic -
  an outbound connector can be taught to accept a specific deliverable format.

### Pillar 5 - View & verify

- **Web-served deliverables** (report/slides/illustration as HTML/SVG) ride the existing preview loop
  unchanged: the agent renders, screenshots, checks logs, and shows proof.
- **The one-shot render gap:** the launch.json model assumes a long-running dev server; a document
  needs "render this file to a viewable page." Add a lightweight doc-preview render target so the
  browser tools have something to point at.
- **Extend the file viewer** to render the deliverable formats it currently can't (at minimum a PDF
  viewer and an HTML-deliverable preview), so the user sees the rendered result in-app.
- **Unify the two proof loops:** today Refine (in-app diff, prose) and Preview (browser proof, web)
  are separate. User Mode wants one surface: agent renders the deliverable, user sees it, user says
  "make the Q3 chart bigger," agent revises and re-renders. Emit the workflow prompt for the
  providers a non-coder actually uses (not openai-compat only).

## Open questions, in the order they need answering

1. **Is `mode` a workspace property, an agent property, or both?** Leaning workspace-level (a project
   _is_ a user project or a dev project) with agent inheritance. Decides where it persists and how the
   UI toggles it.
2. **Deliverable kinds for v1** - is the set `report / slides / doc / sheet / illustration` right, or
   does v1 ship narrower (report + slides only) to prove the loop?
3. **Export backend order** - PDF-via-webview first is cheap; when do docx/pptx (real OOXML) earn
   their weight, and via which library, given the daemon-side execution constraints?
4. **Save engine** - implicit `git init` for every non-git folder, or a separate snapshot store for
   binary-heavy projects? What does "Restore" show a user who has never seen a diff?
5. **Connector registry shape** - where do connector _definitions_ live (a built-in directory + user
   additions), and how does the provider-neutral injection layer avoid doubling tools the way the
   `otto` MCP strip already guards against?
6. **First connectors** - which inbound (data) and outbound (publish) connectors ship first, and does
   OAuth or API-key come first?
7. **Claude base-prompt limit** - is append-only steering enough for a convincing User Mode on
   Claude, or is full User Mode effectively an openai-compat/opencode capability with Claude in a
   reduced mode?

## Phases

Each phase is independently shippable and useful on its own.

1. **Mode primitive (~1–2 medium sessions).** `mode` on the workspace, `composeModeDirective` in
   `prepareSessionConfig`, tool-group gating per mode, a UI toggle. Ships as "the agent knows it is in
   a document project and talks like it," with tools re-framed. No new deliverable formats yet.
2. **Deliverable export (~1–2 sessions).** Add PDF export (print-to-PDF via webview) and a download/
   "save as" affordance to the existing HTML artifacts. Smallest change that lets a non-coder get a
   file _out_ - closes the single biggest current gap.
3. **Editable deliverables (~2–3 sessions).** Widen `ArtifactKind`, add the report/slides/doc kinds,
   and extend the Refine diff loop to deliverables so iteration is a bounded reviewed edit, not a
   regeneration.
4. **Non-code Save (~2 sessions).** The "Save version / Restore / History" vocabulary over git
   commit/rollback + implicit `git init`, in a non-coder project flow. No remote.
5. **View & verify unification (~2–3 sessions).** Doc-preview render target, PDF viewer in the file
   viewer, and the render→show-proof→revise loop wired for the non-coder providers.
6. **Connectors (quarter-scale, multi-phase).** The provider-neutral connector layer, the OAuth/
   API-key auth story, the "Connectors" settings surface, and the first inbound/outbound connectors.
   Largest pillar; gated behind a design pass and product sign-off on the first connector set.

## Protocol

New capabilities are feature-gated per `../../docs/rpc-namespacing.md` and CLAUDE.md's feature
contract - the client detects the capability and shows "update the host" otherwise; no fallback paths.

- `server_info.features.userMode` - mode primitive present. `// COMPAT(userMode)` at the gate.
- `server_info.features.deliverableExport` - export/download available.
- `server_info.features.connectors` - the connector layer is present.
- Deliverable RPCs extend the existing `artifact.*` family rather than forking it, preserving the
  backward-compatible artifact schema (new fields optional with defaults).
- Save RPCs reuse the existing `checkout.git.commit.*` / rollback family under a user-facing vocabulary
  - no new wire contract, a naming/UX layer.
- Connector RPCs use dotted namespaces: `connector.list.request` / `.response`,
  `connector.authorize.request` / `.response`, `connector.revoke.request` / `.response`.

## Risks and open questions

- 🔵 **The Claude append-only limit** may make full User Mode uneven across providers (Q7). Decide
  early whether Claude ships a reduced User Mode or we lean on openai-compat/opencode for the full
  experience.
- 🟡 **Export fidelity vs. effort.** PDF-via-webview is easy but not pixel-faithful to corporate
  templates; real docx/pptx is a large, daemon-side-execution-constrained lift. Do not let Option A
  creep back into the primary path.
- 🟡 **Connector OAuth is greenfield security surface.** No existing flow to copy; tokens must land in
  the masked-secrets path from day one, and the same pass should close the existing gap where provider
  `env` API keys are unmasked.
- 🔵 **Save semantics for non-coders.** "Restore an earlier version" must not surface diffs, conflicts,
  or detached-HEAD states. Getting the implicit-git abstraction leak-free is the subtle risk in
  Pillar 3.
- 🔵 **Scope gravity.** This charter touches six subsystems; the discipline is that Phases 1–2 ship
  standalone value (mode + export) long before the Connectors quarter-scale work, and that
  agent-orchestration / graph-templates / claude-extensions keep their ground.
