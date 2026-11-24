---
id: "otto-0-10-feature-restoration-inventory"
kind: "finding"
title: "Otto 0.10 feature restoration: Paseo coverage, remaining deltas and coupling"
status: "proposed"
tags: ["otto-0.10","paseo-0.12","feature-inventory","mergeability","proposal"]
created_at: "2026-10-21T19:36:35.268Z"
updated_at: "2026-11-12T19:43:03.676Z"
---
# Otto 0.10 feature restoration: Paseo coverage, remaining deltas and coupling

<!-- compiled_truth -->

# Otto 0.10 feature restoration inventory

## Reading this inventory after the rebuild

This is the retained historical source/coupling inventory. Its clean-baseline absence claims, old file/line estimates and proposed integration options are not current delivery percentages. The selected implementations are now integrated on `otto-0.10/phase-0`; F22 provider-only older-history recovery and the named real-environment/product gates remain open. The current master is [[otto-0-10-clean-paseo-rebuild]], including its 2026-11-12 RT1-RT6 transition into testing.

Philippe will conduct UI review himself. This review records only basic structural observations and documentation/status cleanup in [[otto-0-10-testing-readiness-and-ui-structure-review]]. No general UI rollback, theme/chat customization, new feature or provider-isolation work is activated. Preserve all retained future scope below.

This is a proposal for Philippe's review, linked to [[otto-0-10-clean-paseo-rebuild]]. It is an analysis of the frozen Otto 0.9 implementation against pinned Paseo 0.12.0. It does not authorize restoration, a new UI, a release, or changes to Paseo's relay. The user will choose the feature set and discuss changes that touch base behavior.

## Current user selections

The single current scope and review checklist is [[otto-0-10-clean-paseo-rebuild]], reconciled on 2026-11-05 against `1b4c76aa615e20e91f09985c8f0ac7343178c41c`, indexed current software docs and green full CI. This document's baseline/matrix below is the frozen 0.9-versus-Paseo-0.12 analysis, not a present delivery ledger or new implementation authorization.

Restoration has begun and many selected features are integrated. File Editor, viewers, LSP and shipped read-only Solution Files were explicitly promoted and completed. The remaining large ports are Visualizer/PIP/background, Workflows, Schedule extensions and Architectural Views; History/search/archive cleanup remains compare-first. Integrated features retain their stated native/provider/vendor/product-acceptance gaps; source presence is not full signoff. Context generation/startup-isolation research remains parked. Profiles/teams, general chat/agent systems, Communications/Zoom, dictation redesign, appearance work and other deferred families remain retained for later decisions in the master.

## Baseline and method

- Old Otto: `otto-0.9-final`, 95a19522a191394a874320041eaf05f6c5f3c682. Released 0.9.35 is df11c830b8523de2ff465bb2f2fdd95f4736a333; provider/client/server code matched in the earlier cross-version probes.
- New base: Paseo v0.12.0, cafe4b01c8522ff39560241c5deb01427dc8dc5b. Reviewed Otto candidate: c68b0a91161f10ba8e200c36bcea2df506c50870.
- Old Otto's actual Paseo ancestor is b8e24677e12b226c7c38c1c3a40649daa9f1152f (Paseo 0.8). Old comparisons with 0.4 do not describe this source delta.
- Inputs: old `docs/README.md` and subsystem specifications, old production source and capability declarations, active Knowledge charters/requirements, new source and plugin SDK contracts. Old charters contain goals as well as delivered code; a charter is not proof that every listed feature shipped.
- Sizes below count selected old production source files and nonblank lines. Tests, generated code, vendor code and assets are excluded. Areas overlap, and some areas include inherited Paseo code. Do not sum them or interpret them as lines to copy, exclusive ownership, or estimates of development time.
- The import count measures distinct production files outside the selected feature paths with direct static JS/TS imports. It excludes RPC consumers, settings references, dynamic loading, packaging and native calls; separate symbol scans were also reviewed. It is a lower-bound coupling signal, not a dependency completeness guarantee.
- Runtime acceptance remains a requirement for every selected rebuild. This inventory is source and architecture analysis, not proof of feature parity in the new app.

## What the clean Paseo base already supplies

Keep its UI and implementations for the common foundation: agents and sessions, its built-in providers, projects and workspaces, worktrees and git, terminals, MCP and skills, basic profiles and schedules, voice/dictation infrastructure, browser panes and browser automation, web/desktop source editing, Markdown rendering, scoped Find, provider subagents, usage sources, settings, themes, plugins, relay and optional Hub.

Paseo's forge registry already supports GitHub, GitLab, Gitea, Forgejo and Codeberg. Otto's Bitbucket adapter is a remaining delta, not a reason to replace this registry.

Paseo source editing has a material platform boundary: `packages/app/src/file-pane/editor/view.tsx` explicitly renders "Source editing is available on web and desktop." Native Android/iOS editor parity is therefore a separate decision.

Paseo browser automation is already a real daemon/browser-host stack, including snapshots, navigation, interactions, screenshots, uploads, console/network data and evaluation. Restore Preview's missing managed-server behavior against that stack. Do not create a second browser engine.

A generic streamed artifact message, terminal pane, Markdown preview or MCP connection does not establish parity with Otto's durable Artifact library, rich File Editor, or verified Connector catalog.

## Feature manifest

“Plugin candidate” means the declared API appears suitable; it is not a proven implementation. “Discuss seam” means the requested behavior reaches core contracts, host/native integration, shared editor code or global layout.

| Feature family and old scope | Existing Paseo behavior / remaining delta | Old selected footprint: files / lines / outside imports | Coupling and proposed disposition |
| --- | --- | --- | --- |
| Brain local hosting: model library/catalog, GGUF/projector bundles, downloads, calibration, benchmark, logs, hosted llama.cpp, model process pool and queueing | No equivalent managed Brain subsystem in the clean base. Ordinary providers do not replace host model operations. vLLM/SGLang are roadmap work, not automatically restored shipped runtimes. | 124 / 39,278 / 15 | Very large subsystem, moderate integration. Otto-owned host service/package plus plugin screen/settings/RPC is a candidate. Discuss binary distribution, daemon lifetime and provider wiring. |
| Remote Brain and shared host control | Existing general host connectivity does not provide Brain status/config/model management. Old read/config paths exist; not every remote lifecycle/quota ambition was delivered. | Included in Brain | Reuse the same host-owned service contract; preserve local/remote semantics over any supported connection. Depends on Brain and its provider. |
| OpenAI-compatible native agent provider: local/API models, daemon tool loop, filesystem/shell/web tools, MCP, permissions, compaction, rewind | Plugin SDK can register a full provider; generic plugin support alone does not provide Otto's provider. | 6 / 7,086 / 3 | Large behavior despite few files. Strong provider-plugin candidate. Prove cancellation, permission handling, session persistence, compaction/rewind and tool-policy parity before calling it complete. |
| Project Knowledge: repository/host Markdown stores, roots, records, evidence, charters/delivery, references, MCP tools and management UI | Not supplied by base profiles or ordinary project files. Existing .otto stores are retained, while the new app lacks these management features. | 28 / 9,332 / 16 | Large, moderate coupling. Otto-owned service plus plugin screen/MCP is plausible. Atomic writes, store resolution and demand-driven context must survive. |
| Context Management: source graph, token weights/budgets, explicit selection and review context | Provider context usage and compaction exist in varying forms; Otto's graph/selection/review layer is absent. | 36 / 8,213 / 12 | Large, moderate/high semantic coupling. Separate from Knowledge. Before-create/session hooks do not prove a general every-turn injection/refresh seam. Discuss provider-neutral context ownership first. |
| Visualizer: agent graph, chat/subagent activity, aggregate view and audio cues | No equivalent Visualizer in base. Existing subagent/events APIs are useful inputs. | 37 / 8,099 / 15 | Large, moderate coupling for a panel. Plugin workspace panel is a candidate. App-wide audio and event/backfill ownership need review. |
| Visualizer PIP and window-wide placement | Workspace plugin panels do not establish an app-wide overlay or always-resident guest. Old PIP exists; historical Arena goals are not all delivered. | Included in Visualizer | High global-layout/native coupling. Discuss separately; do not force the old overlay into Paseo's shell. |
| Preview managed dev servers: launch configuration, process lifecycle, readiness, diagnostics and verification binding | Base has browser tools and workspace scripts. It does not establish parity with Otto's preview server manager or its workspace-bound token-efficient tool contract. | 3 / 1,186 / 7 | Small/moderate service, important safety semantics. Restore missing lifecycle as an owned service/tool extension and reuse base browser stack. Depends on provider MCP/tool exposure. |
| Browser automation parity | Base already provides browser tools. | 10 / 3,943 / 7 | Reuse. Compare ownership/binding, outputs, token economy and disconnect handling; restore only a measured missing behavior. |
| Browser pane, history, resident tabs and app-owned boundaries | Base already has browser panes. Otto-specific history, resident registry and navigation/popup policies need individual comparison. | 37 / 8,350 / 16 | Moderate/high desktop and layout coupling. Keep base first; discuss each confirmed missing behavior. |
| Artifacts: durable library/storage, generated HTML/interactive views, repair, provenance and design-preserving data updates | Base rendering and artifact messages do not replace this durable subsystem. Old charter has implemented parts and unproven journeys. | 41 / 7,198 / 16 | Large, moderate coupling. Owned service plus plugin screen/panel/attachment actions is a candidate. Generation depends on provider/tool support; renderer isolation and store ownership need explicit proof. |
| Workflows: AI orchestrator runs, declared graphs, validation, nodes/gates, cancellation, run/history visualizers | Base agent orchestration/loops and schedules are useful primitives, not the same durable AI/Graph execution model. | 34 / 12,162 / 17 | Very large, moderate/high coupling. Separate execution service and plugin UI; resolve run ownership, event delivery, cancellation and recovery before rich authoring UI. Do not describe planned node types as delivered. |
| Schedules: profile/provider policy, Workflow targets, project/category storage and artifact updates | Base ordinary existing/new-agent schedules remain. Otto extensions are missing; workflow/artifact target ambitions were not all proven. | 34 / 8,084 / 22 | Delta restoration only. Target-extension registration is not declared by the current public SDK. Discuss a narrow seam or owned scheduler integration; preserve ordinary Paseo behavior. Legacy unsupported schedules are now kept intact and dormant. |
| Agent profiles, personalities, role metadata, profile memory, model tiers and visibility | Base profiles and configuration application already exist. Compare memory, role/tier policy, model visibility and identity snapshots individually. | 16 / 2,369 / 3 | Small selected area with many RPC/settings references. Reuse base profiles; add only accepted policy/memory deltas. Hook support may cover create-time configuration. |
| Teams and orchestration policy: active team, defaults, budgets, bounded tasks and judge contracts | Base basic agent orchestration exists. Otto team/control-layer ambitions extend it; the historical charter is not proof of a complete resumable orchestration engine. | Overlaps profiles/Workflows | Moderate/high shared-contract coupling. Discuss team data and invocation semantics before adding a switcher or replacing agent creation. |
| Observed/provider subagents, accounting and control | Base has provider-subagent store, list/timeline APIs and a panel. Otto's old observed model and provider coverage must be compared against that model. | 34 / 4,973 / 16 | Reuse base hierarchy first. Restore only missing accounting/controls/provider adapters after a per-provider matrix; no parallel observed-agent identity system. |
| Connectors: catalog, credentials/OAuth, tool enumeration, per-tool enablement and provider routing | Base MCP/plugin installation is useful, but not Otto's verified catalog and authorization UX. Old catalog implementation did not establish every vendor's end-to-end readiness. | 20 / 2,926 / 5 | Moderate service with provider/auth dependencies. Plugin catalog/settings and owned credential service are candidates. Keep catalog truth and vendor proof explicit. |
| Managed integration authorization / hosted OAuth | Base Hub login and provider auth are different services. Otto's reusable vendor authorization layer is missing. | 12 / 1,714 / 10 | Moderate integration/security/operations coupling. Rebuild once for selected integrations, then reuse. Any hosted auth service deployment is a separate delivery decision. |
| Communications / Zoom Team Chat: conversations, rooms, search, favorites, presence and notifications | Not supplied by base AI chats. Preserve distinction between human conversations and AI sessions. | 20 / 5,207 / 7 | Large application feature, moderate coupling. Plugin screen/panel candidate; notification and host-local credential behavior require review. Preserve known vendor API limitations rather than inventing parity. |
| Zoom Recorder / meetings: local capture, model lifecycle, transcripts and delivery | Ordinary base speech/dictation does not provide desktop meeting capture. Old initial support is Windows x64/Linux x64, desktop host-local only. | 30 / 3,335 / 6 | Moderate source size, high native/runtime packaging coupling. Needs an owned desktop capture bridge; a JS panel alone is insufficient. Discuss delivery/security modes and model downloads. |
| Voice enhancements, Hey Otto, wake word and read-aloud/voice cues | Base voice and dictation already exist. Compare reply playback, local wake-word lifecycle, Brain/Visualizer cues and Otto-only model settings. | 68 / 13,053 / 29 | Large cross-platform delta. Reuse base audio engine; separate native wake-word integration from plugin playback/UI contributions. Keep microphone capture ownership explicit. |
| Refine and dictation refinement | No equivalent Otto prose-only rewrite/review workflow established in base. | 11 / 1,519 / 5 | Small/moderate isolated service; editor/composer application points are coupled. Plugin command/panel candidate with a narrow apply seam. Preserve prose-only scope and explicit preview/application. |
| File Editor: remote buffers, external files, save conflicts/watchers, search/replace, outline/navigation, editor status and integrated Markdown views | Base has CodeMirror web/desktop editing, Vim, file operations and Find. Otto's full editor behavior and native editing are not equivalent. | 66 / 12,443 / 25 | Large and deeply embedded. Compare subfeatures individually; keep base editor. Discuss every shared buffer/layout/native change instead of porting the old editor wholesale. |
| File viewers / rich Markdown: image/PDF and other formats, split/rendered views, comments and toolbar behavior | Base file pane and enriched Markdown renderer already cover part of this. | 25 / 3,166 / 2 | Mixed small viewers and coupled renderer/editor behavior. Reuse base rendering, validate formats and comment/source mapping separately. Viewer extension registration is not established by public SDK. |
| Code intelligence: language servers, definition, hover, references, diagnostics and reversible rename | Base editor/syntax highlighting does not provide the old daemon LSP pool and editor actions. | 9 / 3,649 / 7 | Moderate service, high editor/protocol coupling. Discuss a daemon LSP boundary and editor integration separately. |
| Solution/project model, code index and fuzzy/outline navigation | Base Explorer and scripts are useful; not the old .NET/project membership and solution model. | 23 / 3,128 / 7 | Moderate, host/toolchain coupled. Owned daemon model plus plugin panel candidate; keep editor navigation seam separate. |
| Architectural Views / Archify | No equivalent authored architecture view identified in base. | 15 / 3,799 / 9 | Moderate, mostly own service/viewer. Plugin screen/panel candidate; depends on interactive-view/Artifact capabilities where reused. |
| Kanban: GitHub Projects/Jira, project board selection and mutations | Base forge PR/issue search is not a Kanban board integration. Old full provider journeys were not all proven. | 14 / 4,098 / 5 | Moderate, relatively separable. Owned adapters plus plugin panel/settings candidate; project board authority and credentials stay separate from Connectors. |
| Git hosting and structural diff/review | Base git, forge adapters, changes and diffs remain. Bitbucket, Otto review comments, richer history, structural diff and fetch policies need separate delta review. | 142 / 25,012 / 53 | Whole area includes much inherited code. High coupling; no wholesale restore. Bitbucket adapter may use registry with a small composition seam; structural diff is a separate high-risk UI/model discussion. |
| Terminal / Vim / Neovim | Base terminal and CodeMirror Vim already exist. Old terminal diagnostics, glyph/native rendering, embedded presentation and editor action mappings need proof against current base. Neovim ambitions were not uniformly finished. | Overlaps editor/git/platform areas | Cross-platform/native coupled. Keep base terminal first; discuss measured incompatibilities and selected missing workflows separately. |
| History, global chat search and archive cleanup | Base agent timeline search/import/history exist. Otto's cross-chat index, provider-aware archive byte reporting and delete/clear semantics are distinct. | 10 / 1,263 / 7 | Moderate service, coupled lifecycle/storage UI. Separate index service candidate; deletion and provider transcript ownership require review. |
| Usage, statistics and performance surfaces | Base provider usage sources and UI exist. Otto's aggregate activity/cost categories, logs, reset/storage metrics and performance monitor are deltas. | 30 / 3,146 / 18 | Moderate/high presentation and provider-observability coupling. Use usage-source plugin for supported data. Never claim universal live token throughput. |
| Chat/composer behavior, queue reordering, suggestions, task cards, permissions, metrics and playback | Base already owns chat, queues, modes and timeline. Individual Otto behaviors are not presumed superior or required. | 113 / 22,164 / 48 | Very high core/UI coupling. Phase 2 discussion. Small plugin composer pills/timeline renderers may fit; lifecycle/scroll/delivery semantics require explicit base discussion. |
| User mode, onboarding, command discovery, settings search and workspace layout preferences | Base settings/command center/layout exist; old simplified mode, tutorials and layout rules are deltas. | 10 / 947 / 5 for selected tutorial/mode files only | Cross-cutting changes are larger than the selected footprint. Phase 2; preserve saved preferences but do not force old navigation onto Paseo. |
| Themes, icon language and appearance | Base theme system exists. | 32 / 5,907 / 364 | Very broad shared-style coupling in the old implementation. Recreate selected themes through addTheme only. Old control geometry/icon/layout patches are separate Phase 2 decisions. |
| Store screenshots and presentation images | Product identity assets already fixed; current branded product captures need later recreation. | Assets excluded from metrics | Explicitly low priority per Philippe. Do not block core testability or start a screenshot redesign. |

## Additional behavior slices that must not disappear inside a broad label

- **Preview versus Scripts versus Service Proxy:** base workspace scripts can replace shared launch plumbing, but Otto's discovery providers, per-worktree port allocation, declared service routes, public aliases and remote service proxy need separate comparison. Old script discovery delivered npm scripts; other provider ideas were plans.
- **Workspace operations:** retain base create/restore/background/pin/project/worktree functions. Compare relocation, worktree reattach/archive branch cleanup, move chat to another workspace, labels, unread behavior, multiple workspaces and default board/profile selection individually. These can touch base lifecycle and require discussion.
- **Agent safety/policy:** old deny-by-default unattended behavior, native provider modes, model visibility/tier overrides, tool groups, action/round breakers and retained ephemeral run transcripts are product contracts, not UI embellishments. Prove actual provider behavior for each restored automation target. Avoid global auth/test gates and provider-specific silent fallback.
- **Suggested tasks and automated prompt generation:** old suggest_task/resolve_task cards, prompt suggestions and model-selected background work are separate from base basic loops. Consider daemon service plus timeline renderer where semantics fit; composer takeover belongs to Phase 2.
- **Provider extensions:** assess old Claude extensions, OpenAI-compatible features and other provider-specific controls against the new adapters. Capability parity means a matrix of supported providers, not an assumption that sharing MCP makes every runtime feature identical.
- **Storage and durability:** Knowledge, Artifacts, Workflows and Schedules have distinct storage ownership. Preserve dormant data now; restoring one category must not silently relocate or reassign another.
- **File mutations and external editor behavior:** base create/rename/duplicate/delete and file writes should remain authoritative. Compare binary writes, files outside a workspace, external-open preferences, Markdown override and dropped-file routing as separate contracts.
- **Platform behavior:** app-wide PIP, tray/minimize, Android rotation, native source editing, speech capture, notification ownership and browser guest restrictions need their own platform matrix. A browser unit test is not native proof.
- **Future-only initiatives:** multiplayer, mobile daemon, general computer use, broader search-engine choices, toolchain catalog, Godot, richer inline completion and preview-tab/architecture ambitions must keep their documented maturity. Do not describe an old charter as a lost shipped feature.
- **Release/build machinery:** retain restored identity, data continuity, npm aliases, unsigned Mac outputs, Android signing, gated iOS, Docker/Nix/site workflows and dev isolation. Re-add native runtime packaging only when the selected feature owns it.
- **Reliability fixes:** compare a historical bug's trigger with current upstream implementation and tests before restoring its patch. UI perfection rules, performance audits and old workarounds are review inputs, not mandatory code ports.

## Recommended sequence, subject to Philippe's selection

1. Finish and review the Phase 0 baseline, including final-source build results and accepted proof boundaries. Acceptance and main landing remain separate actions.
2. Finish scope-setting in the rebuild charter, then agree the first implementation slice and the minimum release set. Respect the selected/conditional/deferred distinctions; the technical inventory does not choose additional features.
3. Prove extension boundaries with one representative vertical slice of each selected class: provider plugin; daemon service plus plugin screen/RPC; browser/managed-preview integration. An unsupported SDK requirement becomes a concrete narrow seam proposal for discussion, not a private import into Paseo internals.
4. Implement shared prerequisites before their dependents: OpenAI-compatible provider/tool exposure before Brain-agent automation; store/authorization contracts before selected consumers; durable run contracts before Workflow schedule targets. Knowledge and its context-injection behavior can be selected independently.
5. Restore relatively separable products in small reviewable increments, using Paseo's existing screens and contribution points. Brain, Knowledge, Artifact library, Kanban and architecture views are selected candidates, with their respective proof obligations. Communications is deferred.
6. Discuss the deeply embedded changes separately: File Editor/LSP/native editing, structural diff, terminal, global PIP, schedule extension dispatch, every-turn context management, chat/composer and workspace lifecycle.
7. Phase 2 evaluates themes, layout, chat and UI preferences on the actual new base. Recreate screenshots after the selected product behavior has settled.

For each selected feature, write a short accepted contract with explicit delivered subfeatures, source/store ownership, dependencies, plugin or seam mechanism, platform/provider support, data migration, happy/recovery proof, and scope boundaries. Then implement only that slice.

## Review conclusions

Brain is substantially larger than File Editor in old source volume but more naturally separable as a subsystem. It still has daemon/provider/settings/scheduling/native-distribution integration; “completely separate” would overstate the evidence. File Editor has stronger shared-buffer, editor, navigation, file watching, layout and platform coupling.

Plugins substantially improve the available boundary. Current SDK supports full providers, typed RPCs, settings, usage sources, screens, workspace panels, commands, composer pills, attachments, themes and timeline contributions. Its before hooks cover agent.create, agent.session_open and workspace.create. That does not prove every-turn context rewriting, a global window overlay, native capture, an editor extension registry, arbitrary forge registration or schedule target dispatch as public plugin APIs.

No features have been restored by this analysis. Philippe's current selections are recorded in the rebuild charter. Finish scope-setting and baseline review before implementation; coupled changes still require explicit discussion.

## Timeline

- time: "2026-10-21T19:36:35.268Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["otto-0-10-clean-paseo-rebuild"]
- time: "2026-10-21T19:36:35.268Z"
  kind: "evidence"
  summary: "Static comparison of otto-0.9-final (95a19522a191394a874320041eaf05f6c5f3c682), its Paseo ancestor b8e24677e12b226c7c38c1c3a40649daa9f1152f, pinned Paseo v0.12.0 cafe4b01c8522ff39560241c5deb01427dc8dc5b and Otto candidate c68b0a91161f10ba8e200c36bcea2df506c50870. Measured production-source footprint and static outside imports using git cat-file batching (.tmp/measure-feature-footprints.mjs and .tmp/feature-footprints.json in the authorized implementation worktree). Reviewed old docs index/subsystem specifications/capabilities and current plugin server/contracts.ts, server/lifecycle.ts, server/provider.ts, client/contracts.ts; current file-pane/editor/view.tsx, browser-tools, provider-subagents, forge-registry and client APIs. Reconciled active charters including Brain/process pool/runtimes, Knowledge/Context, Artifacts, Workflows, Schedules, Connectors, observed subagents, structural diff, Vim/Neovim, Visualizer PIP and Remote Brain. Philippe explicitly requested inventory, sizing and coupling before feature selection, retention of Paseo UI and discussion of base-coupled features; later clarified that recreating presentation images is lower priority. No runtime parity claims or Phase 1 implementation are made by this proposal."
- time: "2026-10-21T21:37:26.312Z"
  kind: "decision"
  summary: "Philippe supplied initial feature selections and explicit deferrals. Point the technical analysis to the charter as the single scope record and remove ambiguity in older illustrative sequencing; do not duplicate a second feature-selection registry or start restoration."
  source: "Philippe's feature selections and follow-up scope/principles messages."
  affects: ["otto-0-10-clean-paseo-rebuild"]
- time: "2026-11-05T14:22:12.547Z"
  kind: "decision"
  summary: "Remove obsolete claims that restoration has not begun and the editor remains deferred. Keep the historical technical matrix intact and point current delivery/review exclusively to the reconciled master checklist, as Philippe requested."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["restoration-checklist","editor"]
- time: "2026-11-12T19:43:03.676Z"
  kind: "decision"
  summary: "Philippe requested a basic Otto 0.10 overview, cleanup and a plan for real testing, then clarified that he will own the UI review. Reconcile verified integration/automation with pending UI/native/account acceptance, retain all selected and deferred scope, label historical counters/inventories correctly, and document the RT1-RT6 controlled-testing sequence without UI code changes or new features."
  source: "https://github.com/Draek2077/otto-code/commit/21a7510c26ad3e0194d89efb659f18f28b3a5586"
  affects: ["otto-0-10-testing-readiness-and-ui-structure-review"]
