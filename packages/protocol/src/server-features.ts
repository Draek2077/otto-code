import { z } from "zod";
import { KanbanServerFeaturesShape } from "./kanban.js";
import { RemoteBrowserServerFeaturesShape } from "./browser-remote/rpc-schemas.js";

// Kept separate so adding a host capability does not grow the session-message registry.
export const ServerFeaturesSchema = z.object({
  // COMPAT(agentRequestReceipts): added in v0.8.0; remove gate after 2027-03-05.
  agentRequestReceipts: z.boolean().optional(),
  // COMPAT(hubAgentRpc): added in v0.8.0; remove gate after 2027-03-05.
  hubAgentRpc: z.boolean().optional(),
  providersSnapshot: z.boolean().optional(),
  // COMPAT(providersSnapshotCwd): added in v0.3.2, remove gate after 2027-02-10.
  providersSnapshotCwd: z.boolean().optional(),
  // COMPAT(directorySync): added in v0.3.x, remove gate after 2027-02-12.
  directorySync: z.boolean().optional(),
  agentWorkspaceFilter: z.boolean().optional(),
  // COMPAT(workspaceLabels): added in v0.5.0, remove after 2027-08-14.
  workspaceLabels: z.boolean().optional(),
  // COMPAT(workspaceSetupRun): added in v0.8.0, remove gate after 2027-09-02.
  workspaceSetupRun: z.boolean().optional(),
  // COMPAT(workspaceTerminals): added in v0.8.0, remove gate after 2027-09-05.
  workspaceTerminals: z.boolean().optional(),
  // COMPAT(checkoutForgeSetAutoMerge): added in v0.2.0-beta.1. Remove the
  // feature gate and checkoutGithubSetAutoMerge fallback after 2027-01-17
  // once the supported daemon floor is >= v0.2.0.
  checkoutForgeSetAutoMerge: z.boolean().optional(),
  // COMPAT(checkoutGithubSetAutoMerge): added in v0.1.75 and retained as
  // the fallback for checkoutForgeSetAutoMerge. Stop advertising and
  // consuming it after 2027-01-17 once supported floors are >= v0.2.0.
  checkoutGithubSetAutoMerge: z.boolean().optional(),
  // COMPAT(githubCheckDetails): added in v0.1.92 and retained as the
  // fallback for forgeCheckDetails. Stop advertising and consuming it
  // after 2027-01-17 once supported floors are >= v0.2.0.
  githubCheckDetails: z.boolean().optional(),
  // COMPAT(forgeCheckDetails): added in v0.2.0-beta.1. Remove the feature
  // gate and githubCheckDetails fallback after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  forgeCheckDetails: z.boolean().optional(),
  // COMPAT(forgeReviewThreads): added in v0.8.15, remove gate after 2027-02-27.
  // The daemon accepts the provider-neutral discussion mutations.
  forgeReviewThreads: z.boolean().optional(),
  // COMPAT(forgeSearch): added in v0.1.106, remove github_search fallback after 2026-12-28.
  forgeSearch: z.boolean().optional(),
  // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
  daemonStatusRpc: z.boolean().optional(),
  // COMPAT(daemonConfigReload): added in v0.4.0, remove gate after 2027-02-14.
  daemonConfigReload: z.boolean().optional(),
  // COMPAT(relayConfig): added in v0.2.6, remove gate after 2027-01-31.
  relayConfig: z.boolean().optional(),
  // COMPAT(pushTokenRevocation): added in v0.3.2, remove gate after 2027-02-10.
  pushTokenRevocation: z.boolean().optional(),
  // COMPAT(plugins): added in v0.3.0, remove gate after 2027-08-07.
  plugins: z.boolean().optional(),
  // COMPAT(pluginManagement): added in v0.4.0, remove gate after 2027-08-14.
  pluginManagement: z.boolean().optional(),
  // COMPAT(pluginLogs): added in v0.4.0, remove gate after 2027-08-16.
  pluginLogs: z.boolean().optional(),
  // COMPAT(pluginGitManagement): added in v0.7.0, remove gate after 2027-08-26.
  pluginGitManagement: z.boolean().optional(),
  // COMPAT(pluginThemes): added in v0.5.0, remove gate after 2027-08-20.
  // A daemon that predates this flag keeps `addTheme` in the server bundle it compiles,
  // so a theme plugin cannot start there at all.
  pluginThemes: z.boolean().optional(),
  pluginSettings: z.boolean().optional(),
  pluginTimelineItems: z.boolean().optional(),
  // COMPAT(skillManagement): added in v0.4.0, remove gate after 2027-08-16.
  skillManagement: z.boolean().optional(),
  // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
  "terminal-restore-modes": z.boolean().optional(),
  // COMPAT(terminalCompatibilityDiagnostic): added in v0.8.9, remove gate after 2027-02-12.
  terminalCompatibilityDiagnostic: z.boolean().optional(),
  terminalEmbeddedPresentation: z.boolean().optional(),
  // COMPAT(terminalTitleSettings): added in v0.8.5, remove gate after 2027-02-07.
  terminalTitleSettings: z.boolean().optional(),
  // COMPAT(terminalInputModeReplay): added in v0.2.6, remove gate after 2027-02-02.
  "terminal-input-mode-replay": z.boolean().optional(),
  // COMPAT(terminalSizeOwnership): added in v0.2.6, remove gate after 2027-02-02.
  "terminal-size-ownership": z.boolean().optional(),
  // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
  rewind: z.boolean().optional(),
  // COMPAT(agentTimelinePromptIndex): added in v0.2.X, drop the gate when floor >= v0.2.X.
  agentTimelinePromptIndex: z.boolean().optional(),
  // COMPAT(agentHistorySearch): added in v0.3.0, remove gate after 2027-02-07.
  agentHistorySearch: z.boolean().optional(),
  chatContentSearch: z.boolean().optional(),
  // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
  checkoutRefresh: z.boolean().optional(),
  // COMPAT(gitFetchControl): added in v0.8.11, remove gate after 2027-02-14.
  gitFetchControl: z.boolean().optional(),
  ...KanbanServerFeaturesShape,
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  workspaceMultiplicity: z.boolean().optional(),
  // COMPAT(projectRemove): added in v0.1.97, drop the gate when floor >= v0.1.97.
  projectRemove: z.boolean().optional(),
  // COMPAT(projectAdd): added in v0.1.97, drop the gate when floor >= v0.1.97.
  projectAdd: z.boolean().optional(),
  // COMPAT(projectScaffold): added in v0.6.9, drop the gate when floor >= v0.6.9.
  // Older daemons can adopt existing folders but cannot create project directories.
  projectScaffold: z.boolean().optional(),
  // COMPAT(worktreeRestore): added in v0.1.97, drop the gate when floor >= v0.1.97
  worktreeRestore: z.boolean().optional(),
  // COMPAT(workspaceRecovery): added in v0.1.105, remove after 2027-01-11 once daemon floor >= v0.1.105.
  workspaceRecovery: z.boolean().optional(),
  // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
  workspaceFileEditing: z.boolean().optional(),
  // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
  providerUsageList: z.boolean().optional(),
  // COMPAT(agentDetach): added in v0.1.98, remove gate after 2026-12-19 once daemon floor >= v0.1.98.
  agentDetach: z.boolean().optional(),
  // COMPAT(agentThinkingUpdate): added in v0.2.4, remove gate after 2027-01-28.
  agentThinkingUpdate: z.boolean().optional(),
  // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
  daemonDiagnostics: z.boolean().optional(),
  // COMPAT(daemonSelfUpdate): added in v0.1.93, remove gate after 2026-12-13.
  daemonSelfUpdate: z.boolean().optional(),
  // Daemon manages the local AI host (otto-brain) as a child: reports
  // brain.host.status, serves brain.host.start/stop/restart, exposes the
  // editable `brain` config block, and honors kill-on-shutdown. Without it
  // the Local brain host UI is hidden ("update the host").
  // COMPAT(brainControl): added in v0.7.5, remove gate after 2026-01-30 once daemon floor >= v0.7.5.
  brainControl: z.boolean().optional(),
  // The daemon persists and applies llama.cpp's `-lv` launch option for
  // the resident Brain runtime. Newer clients must hide this control on
  // older daemons, whose Brain config rejects the field.
  // COMPAT(brainRuntimeLogVerbosity): added in v0.8.10, drop the gate when daemon floor >= v0.8.10.
  brainRuntimeLogVerbosity: z.boolean().optional(),
  // The Brain host can keep multiple independent model processes resident
  // and exposes maxLoadedModels/lockedModels in local and remote settings.
  // COMPAT(brainModelProcessPool): added in v0.8.12, remove after 2027-02-21.
  brainModelProcessPool: z.boolean().optional(),
  // Daemon streams the brain's live status/telemetry via
  // subscribe_brain_status + brain_status_changed, and serves brain.evals.get.
  // Separate from brainControl because status/eval watching can ship after
  // lifecycle control. Without it the Brain dashboard falls back to a
  // periodic brain.host.status poll (no live feed, no eval charts).
  // COMPAT(brainStatus): added in v0.7.5, remove gate after 2026-01-30 once daemon floor >= v0.7.5.
  brainStatus: z.boolean().optional(),
  // Daemon serves brain.network.discover: enumerates this host's bind
  // addresses and probes the local `tailscale` CLI, so the client can
  // offer a listen-host pick-list and auto-fill the tailscale TLS mode.
  // COMPAT(brainNetworkDiscovery): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
  brainNetworkDiscovery: z.boolean().optional(),
  // Daemon can point the brain at a remote host (brain.mode "remote"):
  // status/evals/config proxied from another Otto's brain, no local spawn.
  // COMPAT(brainRemote): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
  brainRemote: z.boolean().optional(),
  // Daemon manages the brain's models and runtimes by shelling out to the
  // otto-brain CLI: serves brain.models.scan / brain.catalog.list /
  // brain.runtime.list (reads) and starts brain.models.pull /
  // brain.runtime.install / brain.calibrate / brain.sweep / brain.bench as
  // tracked jobs polled via brain.jobs.list. Without it the Brain "Models"
  // and "Operations" sections are hidden ("update the host").
  // COMPAT(brainManage): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
  brainManage: z.boolean().optional(),
  // Daemon serves brain.hf.search / brain.hf.quants (reads) and starts
  // brain.models.add (download an arbitrary HF repo's quant) as a pull job.
  // Without it the Brain "Models" section hides the Hugging Face search box.
  // COMPAT(brainHfSearch): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
  brainHfSearch: z.boolean().optional(),
  // Daemon proxies the brain's own /__host/* management API: the joined
  // model inventory, per-model profiles, the VRAM budget, load/unload,
  // delete, and the log tail. Unlike brainManage (which shells out to the
  // CLI and is therefore local-only) these work against a remote brain too.
  // Without it the Brain page is not offered at all. Which of those the
  // brain on the far side actually serves is a separate question, answered
  // by `capabilities` on brain.host.status, because the daemon and the
  // brain version independently.
  // COMPAT(brainConsole): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
  brainConsole: z.boolean().optional(),
  // COMPAT(brainStatusPush): added in v0.8.3, drop the gate when daemon
  // floor >= v0.8.3. The daemon subscribes to the brain's own SSE status
  // stream and broadcasts `brain_status_changed`. Unlike the flags above
  // this is not a fixed daemon capability: it is true only while the
  // SELECTED brain also advertises `capabilities.events`, and the daemon
  // re-broadcasts server_info when that changes. A client that sees it
  // false keeps the explicit status poll.
  brainStatusPush: z.boolean().optional(),
  // COMPAT(brainLogPush): added in v0.8.10, drop the gate when daemon floor >= v0.8.10.
  brainLogPush: z.boolean().optional(),
  // COMPAT(brainLogWatch): added in v0.8.11, drop the gate when daemon
  // floor >= v0.8.11. The daemon serves `brain.logs.watch.request` and
  // pushes `brain_log_line_added` only to sockets that asked for it. A
  // client that sees this false must not advertise the matching client
  // capability: on an older daemon the feed is unconditional, and the
  // watch request it would rely on is unroutable.
  brainLogWatch: z.boolean().optional(),
  // COMPAT(agentForkContext): added in v0.1.102, remove gate after 2026-12-28.
  agentForkContext: z.boolean().optional(),
  browserHistory: z.boolean().optional(),
  ...RemoteBrowserServerFeaturesShape,
  // COMPAT(providerRemove): added in v0.1.105, drop the gate when daemon floor >= v0.1.105.
  providerRemove: z.boolean().optional(),
  // COMPAT(agentContextUsage): added in v0.3.4, drop the gate when daemon floor >= v0.3.4.
  agentContextUsage: z.boolean().optional(),
  // COMPAT(artifacts): added in v0.4.1, drop the gate when daemon floor >= v0.4.1.
  artifacts: z.boolean().optional(),
  // COMPAT(architecturalViews): added in v0.9.0, remove after 2027-02-28.
  architecturalViews: z.boolean().optional(),
  // COMPAT(interactiveViewTypes): added in v0.9.0 on 2026-09-06; remove
  // after 2027-03-06 once every supported host writes typed Interactive Views.
  interactiveViewTypes: z.boolean().optional(),
  // COMPAT(architecturalViewDraftDiscovery): added in v0.9.0, remove after 2027-03-05.
  // A host with Architectural Views but without this gate cannot serve the
  // draft-list RPC introduced for the Knowledge toolbar.
  architecturalViewDraftDiscovery: z.boolean().optional(),
  // COMPAT(observedSubagents): added in v0.4.3, drop the gate when daemon floor >= v0.4.3.
  observedSubagents: z.boolean().optional(),
  // COMPAT(backgroundShellTasks): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
  backgroundShellTasks: z.boolean().optional(),
  // COMPAT(retainedTranscripts): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Daemon retains schedule/artifact generation-agent chats for read-only
  // viewing after the run. See docs/safe-unattended.md.
  retainedTranscripts: z.boolean().optional(),
  // COMPAT(suggestedTasks): added in v0.5.6, drop the gate when daemon floor >= v0.5.6.
  suggestedTasks: z.boolean().optional(),
  suggestedTaskModelSelection: z.boolean().optional(),
  // COMPAT(steerQueue): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  // Daemon owns a per-agent queue of steering messages, accepts
  // `delivery: "queue"` on send, reports `queuedMessages` on the agent
  // snapshot, and serves agent.queue.remove/clear. Without it the
  // composer keeps its own local queue - that is the pre-existing
  // behavior, not a degraded build of this feature.
  steerQueue: z.boolean().optional(),
  // Daemon serves agent.queue.reorder. Separate from `steerQueue`
  // because a daemon on 0.6.8 owns a queue but cannot re-order it;
  // without this the move controls are absent (the queue still works).
  // COMPAT(steerQueueReorder): added in v0.6.9, drop the gate when daemon floor >= v0.6.9.
  steerQueueReorder: z.boolean().optional(),
  // Daemon reports `cumulativeUsage` (the lifetime in/cached/out split
  // plus its own booked cost) on every agent snapshot, so a chat's total
  // spend can be summed and priced honestly. Without it the client shows
  // token totals only and no cost - NOT an estimated cost, which is the
  // behavior this feature exists to remove.
  // COMPAT(cumulativeUsage): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
  cumulativeUsage: z.boolean().optional(),
  // Daemon can resolve and evaluate the provider's context graph, serve
  // context.report.* and push context_report_changed. Without it the
  // client hides both the Context Management tab and the composer
  // warning entirely - there is no degraded client-side fallback, since
  // only the daemon can see the files a provider loads.
  // COMPAT(contextManagement): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
  contextManagement: z.boolean().optional(),
  // COMPAT(textEditor): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
  textEditor: z.boolean().optional(),
  // Refine - the daemon can turn a pinned document plus an instruction
  // into a proposed rewrite (`file.refine.*`). Without it the Refine
  // entry is absent: there is no client-side substitute for a model, and
  // a degraded "open a chat instead" path is exactly the unreviewed edit
  // Refine exists to replace.
  // COMPAT(refine): added in v0.6.9, drop the gate when daemon floor >= v0.6.9.
  refine: z.boolean().optional(),
  // Personality memory - the daemon stores per-personality lessons, injects
  // them at spawn, and serves personality.memory.*. Without it the client
  // hides the Memory tab, the accrual indicator and the transfer-on-delete
  // choice: storage is daemon-side by definition, so there is nothing a
  // client-side fallback could read.
  // COMPAT(personalityMemory): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
  personalityMemory: z.boolean().optional(),
  // COMPAT(projectKnowledge): added in v0.8.5, drop the gate when daemon floor >= v0.8.5.
  projectKnowledge: z.boolean().optional(),
  // COMPAT(projectKnowledgeDeferredRootBodies): added in v0.9.1, remove
  // after 2027-03-04. A new client asks the catalog for root summaries
  // and fetches the selected root body separately.
  projectKnowledgeDeferredRootBodies: z.boolean().optional(),
  // COMPAT(projectKnowledgeRefinement): added in v0.8.19, drop the gate
  // when floor >= v0.8.19.
  projectKnowledgeRefinement: z.boolean().optional(),
  // COMPAT(projectKnowledgeReviewedRefinement): added in v0.8.20, remove
  // the gate after 2027-02-26. The dedicated reviewed-Knowledge proposal
  // RPC is not supported by hosts that only expose the original apply RPC.
  projectKnowledgeReviewedRefinement: z.boolean().optional(),
  // COMPAT(projectKnowledgeAnchoredRefinement): added in v0.8.21, remove
  // the gate after 2027-02-27.
  projectKnowledgeAnchoredRefinement: z.boolean().optional(),
  // COMPAT(projectKnowledgeTagEditing): added in v0.8.21, remove the
  // gate after 2027-02-27.
  projectKnowledgeTagEditing: z.boolean().optional(),
  // COMPAT(projectKnowledgeStoreLocation): added in v0.8.18, drop the gate
  // when daemon floor >= v0.8.18. A project's Knowledge store can live
  // host-local instead of in the repository: the project.knowledge.store.*
  // RPCs, the per-project override, and the host default setting.
  projectKnowledgeStoreLocation: z.boolean().optional(),
  // COMPAT(artifactStoreLocation): added in v0.9.0, remove after 2027-02-28.
  // The host supports the independent Artifacts storage default and
  // per-project overrides.
  artifactStoreLocation: z.boolean().optional(),
  // COMPAT(artifactRepair): added in v0.9.0, remove after 2027-02-28.
  // The host monitors externally edited artifacts and can restore a
  // retained last-known-good output through artifact.repair.request.
  artifactRepair: z.boolean().optional(),
  // COMPAT(artifactDataUpdate): added in v0.9.0, remove after 2027-02-28.
  artifactDataUpdate: z.boolean().optional(),
  // COMPAT(artifactStoreMove): added in v0.9.0, remove after 2027-02-28.
  // The host can explicitly transfer a settled artifact between its
  // repository and host-local stores without changing write preferences.
  artifactStoreMove: z.boolean().optional(),
  // COMPAT(artifactWorkspaceDiscovery): added in v0.9.11, remove after 2027-03-12.
  artifactWorkspaceDiscovery: z.boolean().optional(),
  // COMPAT(artifactProvenance): added in v0.9.0, remove after 2027-02-28.
  // The host persists and exposes an Artifact's latest durable source.
  artifactProvenance: z.boolean().optional(),
  // COMPAT(categoryStorageResolver): added in v0.9.0, remove after 2027-02-28.
  // An additive shared resolver with a declared supported-category set.
  categoryStorageResolver: z
    .object({ categories: z.array(z.string().min(1)) })
    .passthrough()
    .optional(),
  // Script discovery - the daemon scans a workspace for the Scripts its
  // project files already declare (package.json scripts, and later
  // Makefile targets, .NET launch profiles) and serves them from
  // `workspace.script.list` with `includeDiscovered`. Without it the
  // Scripts dropdown shows only what otto.json declares, which is the
  // pre-existing behavior and not a degraded build of this feature: only
  // the daemon can read the workspace's files, so there is no client-side
  // scan to fall back to.
  // COMPAT(workspaceScriptDiscovery): added in v0.7.6, drop the gate when daemon floor >= v0.7.6.
  workspaceScriptDiscovery: z.boolean().optional(),
  // COMPAT(projectSearch): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
  projectSearch: z.boolean().optional(),
  // COMPAT(codeIndex): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
  codeIndex: z.boolean().optional(),
  // Language-server-backed definitions (`code.definition`, `code.document.*`).
  // Separate from `codeIndex`: that gate covers the ctags path, which stays as
  // the outline/fuzzy-finder source and the no-server fallback.
  // COMPAT(lsp): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  lsp: z.boolean().optional(),
  // The daemon answers `lsp.servers.list` host-wide, with no `cwd`. The settings
  // screen is a host screen: it lists every language server this machine knows how
  // to run and whether it can supply the binary, and it must not need a workspace
  // open to say so. An older daemon rejects a request with no `cwd`, so without the
  // flag the client says to update the host rather than showing an empty screen.
  // COMPAT(lspHostServers): added in v0.7.3, drop the gate when daemon floor >= v0.7.3.
  lspHostServers: z.boolean().optional(),
  // The Solution view - the daemon can discover solutions and serve
  // `code.solution.*`. Deliberately NOT implied by `lsp`: there is no
  // project-structure request in LSP, so this subsystem is independent of
  // language servers and of the C# row's on/off state. Without the flag the
  // client never shows the view switcher and never asks - there is no
  // client-side substitute for reading a solution, and a hand-parsed
  // half-tree is exactly the mistake this design exists to avoid.
  // COMPAT(solutionView): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  solutionView: z.boolean().optional(),
  // COMPAT(artifactsToolGroup): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
  artifactsToolGroup: z.boolean().optional(),
  // COMPAT(speechSettings): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
  speechSettings: z.boolean().optional(),
  // COMPAT(gitHostingProviders): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
  gitHostingProviders: z.boolean().optional(),
  // COMPAT(agentPersonalities): added in v0.5.0, drop the gate when daemon floor >= v0.5.0.
  agentPersonalities: z.boolean().optional(),
  // COMPAT(ttsPreview): added in v0.4.7, drop the gate when daemon floor >= v0.4.7.
  ttsPreview: z.boolean().optional(),
  // COMPAT(ttsSpeak): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  // Host can stream a full message aloud on demand (per-message playback).
  ttsSpeak: z.boolean().optional(),
  // COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
  visualizerVoiceCues: z.boolean().optional(),
  // The daemon accepts the profile-named halves of the personality RPCs
  // (agent.profile.*, profile.memory.*). Purely a rename: the legacy names
  // keep working, so this gates WHICH literal the client emits, never
  // whether the feature exists.
  // COMPAT(agentProfileRpcs): added in v0.8.13, drop the gate when daemon floor >= v0.8.13.
  agentProfileRpcs: z.boolean().optional(),
  // COMPAT(personalityProfile): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
  // Host can author a personality profile (the prompt prose) from a name,
  // roles, and spinner colors.
  personalityProfile: z.boolean().optional(),
  // COMPAT(setAgentPersonality): added in v0.5.0, drop the gate when daemon floor >= v0.5.0.
  setAgentPersonality: z.boolean().optional(),
  // COMPAT(checkoutGitCommit): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
  checkoutGitCommit: z.boolean().optional(),
  // COMPAT(checkoutGitCommitAgent): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
  checkoutGitCommitAgent: z.boolean().optional(),
  // COMPAT(checkoutGitRollback): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
  checkoutGitRollback: z.boolean().optional(),
  // COMPAT(checkoutGitLog): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
  checkoutGitLog: z.boolean().optional(),
  // Local-git file investigation: history, per-commit diff, blame, origin
  // commit - for a whole file or a line range. No forge connection needed
  // and no per-provider rollout; it is git, so every provider gets it at
  // once.
  // COMPAT(checkoutGitFileHistory): added in v0.6.6, drop the gate when daemon floor >= v0.6.6.
  checkoutGitFileHistory: z.boolean().optional(),
  // Set when the daemon can inspect a worktree's leftover branch before
  // archiving (workspace.archive.preflight.*) and delete it as part of the
  // archive (archive_workspace_request.branchDisposition). Without it the
  // client archives the worktree exactly as before and never offers to
  // remove the branch - no degraded client-side branch detection exists.
  // COMPAT(worktreeArchiveBranchCleanup): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  worktreeArchiveBranchCleanup: z.boolean().optional(),
  // COMPAT(worktreeReattach): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  worktreeReattach: z.boolean().optional(),
  projectRelocation: z.boolean().optional(),
  // Set when the daemon can repoint a worktree's stored base branch
  // (worktree.baseRef.set.*). Without it the client renders the base as a
  // read-only "vs <base>" label - there is no client-side override, since only
  // the daemon can write the worktree's metadata.
  // COMPAT(worktreeDiffBase): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  worktreeDiffBase: z.boolean().optional(),
  // Set when the daemon stores the diff base *per branch*, which is what lets any git
  // checkout repoint it rather than only an Otto worktree - a plain checkout's gitdir is
  // shared by every branch in it, so a single stored base would bleed across branch
  // switches. Also gates parent-branch detection, the `origin/`-qualified pin, and the
  // re-detect action. Without it the client keeps the worktree-only picker.
  // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4, drop the gate when daemon floor >= v0.7.4.
  checkoutDiffBaseAnyRepo: z.boolean().optional(),
  // Set when the daemon persists the host-level hideMergeIntoBaseAction
  // workspace policy (read/written via the daemon config RPCs). Without
  // it the client hides the Workspaces toggle, since patching the field
  // on an old daemon would silently fail to stick.
  // COMPAT(hideMergeIntoBaseSetting): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  hideMergeIntoBaseSetting: z.boolean().optional(),
  // COMPAT(agentTeams): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
  agentTeams: z.boolean().optional(),
  // COMPAT(agentTeamProjectDefaults): added in v0.9.17, drop the gate when daemon floor >= v0.9.17.
  agentTeamProjectDefaults: z.boolean().optional(),
  // COMPAT(modelTierOverrides): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
  modelTierOverrides: z.boolean().optional(),
  // COMPAT(modelVisibilityOverrides): added in v0.8.18, drop the gate when daemon floor >= v0.8.18.
  modelVisibilityOverrides: z.boolean().optional(),
  // COMPAT(savedProviderEndpoints): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
  savedProviderEndpoints: z.boolean().optional(),
  // COMPAT(agentOrchestration): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
  agentOrchestration: z.boolean().optional(),
  // COMPAT(activityStats): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
  activityStats: z.boolean().optional(),
  // COMPAT(runsClear): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
  runsClear: z.boolean().optional(),
  // COMPAT(runsDelete): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  runsDelete: z.boolean().optional(),
  // COMPAT(runsDraftEdit): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
  // The daemon accepts `runs.start` with `draft: true` AND a `runId`,
  // re-saving that draft in place instead of minting a second one.
  runsDraftEdit: z.boolean().optional(),
  // COMPAT(workflowStartRpc): added in v0.9.0, remove after 2027-02-28.
  // A new client uses workflows.start when this is true; an older daemon
  // continues to receive the established runs.start pair.
  workflowStartRpc: z.boolean().optional(),
  // COMPAT(workflowStartConfirmation): added in v0.9.0, remove after
  // 2027-02-28. A new client refuses the start surface rather than
  // claiming it can enforce agent-count confirmation on an older host.
  workflowStartConfirmation: z.boolean().optional(),
  // COMPAT(orchestrationGraphs): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  orchestrationGraphs: z.boolean().optional(),
  // COMPAT(graphCheckOutputPorts): added in v0.9.0, remove after 2027-02-28.
  // A client must not offer Check recovery routing to a host that still
  // treats a false Check as an unconditional terminal failure.
  graphCheckOutputPorts: z.boolean().optional(),
  // COMPAT(scheduleWorkflowTargets): added in v0.9.0, remove after 2027-02-28.
  // The Schedule editor may select saved Workflow definitions only when
  // the host performs the project/definition resolution and audit.
  scheduleWorkflowTargets: z.boolean().optional(),
  // COMPAT(fileOutsideWorkspace): added in v0.5.8, drop the gate when daemon floor >= v0.5.8.
  // Set when the daemon will serve single-file read/write/watch for paths
  // outside every known workspace (bounded only by OS filesystem
  // permissions). An old daemon leaves the flag unset, so the client does
  // not route external files through this access path.
  fileOutsideWorkspace: z.boolean().optional(),
  // COMPAT(promptSuggestions): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
  // Set when the daemon emits agent_stream `prompt_suggestion` events (native
  // Claude next-prompt predictions). The client gates the Settings toggle on
  // this; suggestions already degrade silently on an old daemon (no event).
  promptSuggestions: z.boolean().optional(),
  // COMPAT(rateLimitEvents): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
  // Set when the daemon emits agent_stream `rate_limit_updated` events (Claude
  // plan rate-limit status). Warnings degrade silently on an old daemon (no event).
  rateLimitEvents: z.boolean().optional(),
  // COMPAT(openaiCompatMaxToolRounds): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon honors the provider-level `maxToolRounds` override for
  // openai-compat agents. The client gates the Agents-tab control on this so an
  // old daemon (which silently ignores the field and keeps the fixed 50-round
  // cap) shows "Update the host" instead of a knob that does nothing.
  openaiCompatMaxToolRounds: z.boolean().optional(),
  // COMPAT(openaiCompatActionBreaker): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  // Set when the daemon honors the provider-level `actionBreaker` config for
  // openai-compat agents (stops a repeatedly-failing identical action and
  // sends the model a repair prompt). The client gates the Agents-tab control
  // on this so an old daemon (which ignores the field) shows "Update the
  // host" instead of a switch that does nothing.
  openaiCompatActionBreaker: z.boolean().optional(),
  // COMPAT(openaiCompatMidSessionUpdates): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  // Set when the daemon honors the provider-level `midSessionContextUpdates`
  // switch for openai-compat agents (whether the tool loop may add context,
  // today a subdirectory instruction file, after the conversation starts).
  // The client gates the Agents-tab control on this so an old daemon (which
  // ignores the field and always injects) shows "Update the host" instead of
  // a switch that does nothing.
  openaiCompatMidSessionUpdates: z.boolean().optional(),
  // Provider-level Otto tool policy is persisted and enforced for exact provider IDs.
  providerOttoToolPolicy: z.boolean().optional(),
  // COMPAT(mcpToolGroups): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon honors `mcp.toolGroups` - per-group gating of the
  // Otto tool catalog on the MCP (Claude) path. Old daemons register every
  // group regardless, so the client hides the categorized section instead
  // of showing category switches that do nothing.
  mcpToolGroups: z.boolean().optional(),
  // COMPAT(connectors): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
  // Set when the daemon persists and honors `connectors` - MCP servers
  // surfaced as named, toggle-able integrations with per-tool disable,
  // enforced today on the openai-compat path. Old daemons ignore the
  // section, so the client hides the Connectors settings entirely.
  connectors: z.boolean().optional(),
  // COMPAT(connectorOauth): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
  // Set when the daemon can run the OAuth authorization-code flow for a
  // connector and attach the resulting token to its MCP transport. Old
  // daemons have no broker and no way to hold a token, so the client hides
  // Connect / Disconnect and offers only the paste-a-token connectors.
  connectorOauth: z.boolean().optional(),
  connectorGoogleOauth: z.boolean().optional(),
  connectorNativeGoogle: z.boolean().optional(),
  connectorHostedOauth: z.boolean().optional(),
  // COMPAT(communications): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  // The daemon owns the provider-neutral communications overview. An old
  // host must not receive a communications RPC from a newer frontend.
  communications: z.boolean().optional(),
  // COMPAT(communicationsChatHome): added in v0.8.11, remove gate after 2027-02-14.
  // A host that lacks this projection must not receive the detailed Chat
  // Home request from a newer frontend.
  communicationsChatHome: z.boolean().optional(),
  // COMPAT(communicationsInboxSearch): added in v0.8.11, remove gate after
  // 2027-02-15. A host without destination search must not receive its RPC.
  communicationsInboxSearch: z.boolean().optional(),
  // COMPAT(communicationsFavorites): added in v0.8.11, remove gate after
  // 2027-02-15. The host owns provider-native favorite reads and writes.
  communicationsFavorites: z.boolean().optional(),
  // COMPAT(communicationsPresence): added in v0.8.11, remove gate after 2027-02-14.
  // A host that lacks daemon-owned presence must not receive presence RPCs.
  communicationsPresence: z.boolean().optional(),
  // COMPAT(communicationsChatAvailability): added in v0.8.11, remove gate after 2027-02-14.
  // A host that lacks daemon-owned Chat availability must not receive its toggle RPC.
  communicationsChatAvailability: z.boolean().optional(),
  // COMPAT(communicationsPresenceChangeTiming): added in v0.8.11, remove gate after 2027-02-14.
  // The daemon publishes authoritative provider presence-change cooldowns.
  communicationsPresenceChangeTiming: z.boolean().optional(),
  // COMPAT(communicationsPresenceUpdates): added in v0.8.11, remove gate after 2027-02-14.
  // A capable client receives daemon-owned presence queue transitions and
  // cooldown updates without polling its popup.
  communicationsPresenceUpdates: z.boolean().optional(),
  // COMPAT(communicationsRooms): added in v0.8.11, remove gate after 2027-02-15.
  // A room carries thread and reaction semantics an older daemon cannot
  // safely emulate through the legacy flat inbox message RPCs.
  communicationsRooms: z.boolean().optional(),
  // COMPAT(communicationsRoomNotifications): added in v0.8.11, remove gate after 2027-02-15.
  // Acknowledgement mutates daemon-local state and older hosts do not know this RPC.
  communicationsRoomNotifications: z.boolean().optional(),
  // COMPAT(meetingTranscripts): added in v0.8.11, remove gate after 2027-02-13.
  meetingTranscripts: z.boolean().optional(),
  // COMPAT(integrationAuthorization): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  // The daemon exposes secure-vault readiness and connection metadata for
  // reusable integration settings. Old hosts must not receive these RPCs.
  integrationAuthorization: z.boolean().optional(),
  // COMPAT(integrationAuthorizationBrowserFlow): added in v0.8.10, remove gate after 2027-02-14.
  // The daemon routes browser sign-in through registered, provider-neutral
  // drivers. Older hosts only understand provider-specific legacy RPCs.
  integrationAuthorizationBrowserFlow: z.boolean().optional(),
  // COMPAT(agentBehaviorToggles): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon persists `agentBehaviors.*` (promptSuggestions,
  // agentProgressSummaries, notifyOnFinishDefault). The reads are wired by
  // Claude-tier providers (WP-E); the client gates the toggle cards on this.
  agentBehaviorToggles: z.boolean().optional(),
  // The host resolves send_chat_prompt's omitted delivery from Default send.
  agentToAgentDefaultSend: z.boolean().optional(),
  // COMPAT(todoReminders): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
  // Set when the daemon acts on `agentBehaviors.{todoNudge,todoReconcileOnIdle}` -
  // the provider-agnostic stale-todo nudge (next turn) and idle reconcile pass.
  // The client gates the task-list toggle cards on this so an old daemon never
  // shows switches that do nothing.
  todoReminders: z.boolean().optional(),
  // COMPAT(metadataGenerationEnabled): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon persists `metadataGeneration.{enabled,preferWriterPersonalities}`.
  // The generation path (WP-B) reads them; the client gates the toggle cards on this.
  metadataGenerationEnabled: z.boolean().optional(),
  // COMPAT(usageCostCategories): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon populates the per-category token/cost counters in
  // ActivityCounters (mainChat/generations/subagents/compaction + Claude
  // provider split + micro-USD cost). An old daemon leaves them all at 0,
  // so the client hides the Usage & Cost column's category grid rather than
  // presenting a column of zeros as if it were truthful accounting.
  usageCostCategories: z.boolean().optional(),
  // COMPAT(usageLog): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon serves the itemized usage ledger (usage.log.get).
  // The client gates the Metrics screen's "Log" tab on this; an old daemon
  // simply doesn't offer the tab.
  usageLog: z.boolean().optional(),
  // COMPAT(statsReset): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  // Set when the daemon handles stats.activity.reset (wipe all usage
  // counters + the itemized ledger). The client gates the Metrics screen's
  // "Reset" button on this; an old daemon simply doesn't offer it.
  statsReset: z.boolean().optional(),
  // COMPAT(historyDelete): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
  // Set when the daemon offers hard delete for chat records: per-row via
  // the existing `delete_agent_request`, and in bulk via
  // `history.agents.clear_archived`. Archive has always been a soft delete
  // with no counterpart; this is the counterpart. Deleting removes Otto's
  // record only - provider transcripts are never touched (see the
  // clear_archived schema). The client hides both affordances when this is
  // absent rather than shipping a degraded path.
  historyDelete: z.boolean().optional(),
  // COMPAT(fileMutations): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
  // Set when the daemon serves `file.create`, `file.delete` and
  // `file.rename` - creating, removing and moving entries, as opposed to
  // `file.write`, which only changes what is inside an existing file.
  // There is no client-side substitute (the client never touches the
  // filesystem), so an old daemon simply does not get the menu items.
  fileMutations: z.boolean().optional(),
  // COMPAT(binaryFileWrite): added in v0.7.6, drop the gate when daemon
  // floor >= v0.7.6. Set when the daemon serves
  // `fs.file.write_binary` - bytes to a workspace path, as opposed to
  // `fs.file.write`, which is text and refuses binary targets outright.
  // The client cannot write a workspace file itself on any platform, so
  // an old daemon simply does not offer the exports that produce bytes.
  binaryFileWrite: z.boolean().optional(),
  // COMPAT(attachmentStorage): added in v0.7.1, drop the gate when daemon floor >= v0.7.1.
  // Set when the daemon serves `attachments.images.get_stats` and
  // `attachments.images.clear` - the readout and reclaim for the images it
  // materializes on the agent's behalf. The client has no way to size or
  // clear a directory on the host, so an old daemon simply does not get
  // the daemon half of the Storage section; the app-side preview cache row
  // is local and always shown.
  attachmentStorage: z.boolean().optional(),
  // COMPAT(historyStorage): added in v0.7.2, drop the gate when daemon floor >= v0.7.2.
  historyStorage: z.boolean().optional(),
  // COMPAT(agentWorkspaceTransfer): added in v0.7.4, drop the gate when
  // daemon floor >= v0.7.4. Set when the daemon serves
  // `agent.workspace.transfer` - moving a chat to another workspace over
  // the same directory. The client cannot restamp ownership itself (it is
  // daemon state), so an old daemon simply does not get the menu item.
  agentWorkspaceTransfer: z.boolean().optional(),
  // COMPAT(agentForkContextCursor): added in v0.1.108, remove gate after 2027-01-14.
  agentForkContextCursor: z.boolean().optional(),
  // COMPAT(providerSubagents): added in v0.1.107, remove gate after 2027-01-12.
  providerSubagents: z.boolean().optional(),
  providerSubagentControl: z.boolean().optional(),
  // COMPAT(providerSubagentNesting): added in v0.7, remove gate after 2027-03-04.
  providerSubagentNesting: z.boolean().optional(),
  // COMPAT(workspacePinning): added in v0.1.107, remove gate after 2027-01-12.
  workspacePinning: z.boolean().optional(),
  // COMPAT(workspaceMarkUnread): added in v0.5.0, remove after 2027-08-20.
  workspaceMarkUnread: z.boolean().optional(),
  // COMPAT(hubRelationship): added in v0.1.X, drop the gate when floor >= v0.1.X.
  hubRelationship: z.boolean().optional(),
  // COMPAT(projectGithubClone): added in v0.1.108, remove gate after 2027-01-15.
  projectGithubClone: z.boolean().optional(),
  // COMPAT(workspaceGithubRepositorySearch): added in v0.1.108, remove gate after 2027-01-15.
  workspaceGithubRepositorySearch: z.boolean().optional(),
  // COMPAT(projectCreateDirectory): added in v0.1.108, remove gate after 2027-01-15.
  projectCreateDirectory: z.boolean().optional(),
  // COMPAT(projectList): added in v0.2.4, drop the gate when floor >= v0.2.4.
  projectList: z.boolean().optional(),
  // COMPAT(commitsList): added in v0.1.110, remove gate after 2027-01-16.
  commitsList: z.boolean().optional(),
  // COMPAT(commitBaseClassification): added in v0.2.0, remove gate after 2027-01-23.
  commitBaseClassification: z.boolean().optional(),
  // COMPAT(providerRemoval): added in v0.1.105, drop the gate when floor >= v0.1.105.
  providerRemoval: z.boolean().optional(),
  // COMPAT(importSessionWorkspaceTarget): added in v0.1.110, remove gate after 2027-01-16.
  importSessionWorkspaceTarget: z.boolean().optional(),
  // COMPAT(importSessionSearch): added in v0.8.0, remove gate after 2027-03-02.
  importSessionSearch: z.boolean().optional(),
  // COMPAT(forgeProviders): added in v0.2.0-beta.1. Drop the gate after
  // 2027-01-17 once the supported daemon floor is >= v0.2.0.
  // Daemon advertises pluggable non-GitHub forge support (the forge registry);
  // the client gates non-GitHub setup UI on it.
  forgeProviders: z.boolean().optional(),
  forgeConnections: z.boolean().optional(),
  // COMPAT(selectiveAgentTimeline): added in v0.1.106, remove after 2027-01-12.
  selectiveAgentTimeline: z.boolean().optional(),
  explicitEventSubscriptions: z.boolean().optional(),
  // COMPAT(canonicalSubmittedPrompts): added in v0.2.6, remove gate after 2027-01-30.
  canonicalSubmittedPrompts: z.boolean().optional(),
  // COMPAT(agentTurnIdentity): accept peers that observed pre-release v0.2.6 through 2027-01-31.
  agentTurnIdentity: z.boolean().optional(),
  // COMPAT(stableProjectIdentity): added in v0.1.109, remove gate after 2027-01-15.
  stableProjectIdentity: z.boolean().optional(),
  // COMPAT(workspaceScriptManagement): added in v0.1.105, remove gate after 2027-01-10.
  workspaceScriptManagement: z.boolean().optional(),
  // COMPAT(projectCustomIcon): added in v0.2.0, remove after 2027-01-20.
  projectCustomIcon: z.boolean().optional(),
  // COMPAT(fsEntryOps): added in v0.3.0, remove gate after 2027-02-08.
  fsEntryOps: z.boolean().optional(),
  // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
  fsEntryDuplicate: z.boolean().optional(),
  // COMPAT(checkoutDiscardChanges): added in v0.3.0, remove gate after 2027-02-08.
  checkoutDiscardChanges: z.boolean().optional(),
  // COMPAT(agentProfiles): added in v0.3.2, remove gate after 2027-02-11.
  // An older daemon parses its persisted config strictly, so writing
  // agentProfiles to one is silently dropped. The client hides the feature
  // rather than letting a save appear to succeed.
  agentProfiles: z.boolean().optional(),
  // COMPAT(agentConfigApply): added in v0.3.2, remove gate after 2027-02-11.
  agentConfigApply: z.boolean().optional(),
});
