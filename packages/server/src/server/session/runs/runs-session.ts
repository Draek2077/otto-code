import { randomUUID } from "node:crypto";
import type pino from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { AgentAutoTitleRequest } from "../../agent/agent-auto-title.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { GraphStore } from "../../workflow/graph-store.js";
import type { GraphSharingService } from "../../workflow/graph-sharing-service.js";
import type { NodeOutputStore } from "../../workflow/node-output.js";
import type { PromptTemplateStore } from "../../workflow/prompt-template-store.js";
import { graphHash } from "../../workflow/graph-identity.js";
import { type WorkflowService, toWireRun } from "../../workflow/workflow-service.js";
import {
  startUserOrchestration,
  type StartUserOrchestrationInput,
} from "../../workflow/user-workflow.js";
import type { CreateOttoWorktreeWorkflowFn } from "../../worktree-session.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { AgentUpdatesService } from "../agent-updates/agent-updates-service.js";

/**
 * Everything the runs RPCs need from the owning session: the wire, and the two
 * session-owned workflows `runs.start` hands to agent creation (worktree
 * provisioning and auto-titling with the session's focused-agent selection).
 */
export interface RunsSessionHost {
  emit(msg: SessionOutboundMessage): void;
  createOttoWorktree: CreateOttoWorktreeWorkflowFn;
  scheduleAutoTitle(request: AgentAutoTitleRequest): void;
}

export interface RunsSessionOptions {
  host: RunsSessionHost;
  runService: WorkflowService | null | undefined;
  graphStore: GraphStore | null | undefined;
  graphSharingService?: GraphSharingService | null;
  nodeOutputStore: NodeOutputStore | null | undefined;
  promptTemplateStore: PromptTemplateStore | null | undefined;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  daemonConfigStore: DaemonConfigStore;
  agentUpdates: AgentUpdatesService;
  ottoHome: string;
  worktreesRoot: string | undefined;
  logger: pino.Logger;
}

// Map the wire message onto the orchestration input, dropping absent optionals
// (exactOptionalPropertyTypes). Module-level so the RPC handler stays under
// the complexity ceiling.
function buildStartUserWorkflowInput(
  msg: Extract<
    SessionInboundMessage,
    { type: "runs.start.request" } | { type: "workflows.start.request" }
  >,
): StartUserOrchestrationInput {
  return {
    flavor: msg.flavor,
    cwd: msg.cwd,
    ...(msg.workspaceId !== undefined ? { workspaceId: msg.workspaceId } : {}),
    ...(msg.title !== undefined ? { title: msg.title } : {}),
    ...(msg.description !== undefined ? { description: msg.description } : {}),
    ...(msg.orchestratorPersonalityId !== undefined
      ? { orchestratorPersonalityId: msg.orchestratorPersonalityId }
      : {}),
    ...(msg.orchestratorProvider !== undefined
      ? { orchestratorProvider: msg.orchestratorProvider }
      : {}),
    ...(msg.orchestratorModel !== undefined ? { orchestratorModel: msg.orchestratorModel } : {}),
    ...(msg.orchestratorThinkingOptionId !== undefined
      ? { orchestratorThinkingOptionId: msg.orchestratorThinkingOptionId }
      : {}),
    ...(msg.prompt !== undefined ? { prompt: msg.prompt } : {}),
    ...(msg.graphId !== undefined ? { graphId: msg.graphId } : {}),
    ...(msg.graphInputs !== undefined ? { graphInputs: msg.graphInputs } : {}),
    ...(msg.draft !== undefined ? { draft: msg.draft } : {}),
    ...(msg.runId !== undefined ? { runId: msg.runId } : {}),
  };
}

/**
 * The daemon binds a Graph review to the exact launch request. This is kept
 * session-local: reconnecting simply requires a fresh factual review.
 */
const MAX_PENDING_START_CONFIRMATIONS = 16;

function workflowStartFingerprint(
  input: StartUserOrchestrationInput,
  reviewedGraphHash: string | null,
): string {
  return JSON.stringify({
    // The confirmation acknowledges the agent count of a specific Graph
    // document, so an edit between review and start must invalidate it.
    reviewedGraphHash,
    flavor: input.flavor,
    cwd: input.cwd,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    orchestratorPersonalityId: input.orchestratorPersonalityId,
    orchestratorProvider: input.orchestratorProvider,
    orchestratorModel: input.orchestratorModel,
    orchestratorThinkingOptionId: input.orchestratorThinkingOptionId,
    prompt: input.prompt,
    graphId: input.graphId,
    graphInputs: input.graphInputs
      ? Object.fromEntries(
          Object.entries(input.graphInputs).sort(([left], [right]) => left.localeCompare(right)),
        )
      : undefined,
    draft: input.draft,
    runId: input.runId,
  });
}

function isProjectWorkflowLibraryRequest(
  msg: SessionInboundMessage,
): msg is Extract<
  SessionInboundMessage,
  | { type: "workflows.graph.save.request" }
  | { type: "workflows.templates.list.request" }
  | { type: "workflows.template.save.request" }
  | { type: "workflows.storage.transfer.request" }
> {
  return (
    msg.type === "workflows.graph.save.request" ||
    msg.type === "workflows.templates.list.request" ||
    msg.type === "workflows.template.save.request" ||
    msg.type === "workflows.storage.transfer.request"
  );
}

/**
 * The Otto orchestration-runs session domain: run snapshot and control, graph
 * and prompt-template storage, and starting a user orchestration. Extracted
 * from `session.ts` so the dispatcher dispatches and the domain owns its own
 * logic, matching the shape Paseo uses for checkout, files, voice and the rest
 * (and the shape `session/brain/` and `session/communications/` follow).
 */
export class RunsSession {
  private readonly host: RunsSessionHost;
  private readonly runService: WorkflowService | null | undefined;
  private readonly graphStore: GraphStore | null | undefined;
  private readonly graphSharingService: GraphSharingService | null;
  private readonly nodeOutputStore: NodeOutputStore | null | undefined;
  private readonly promptTemplateStore: PromptTemplateStore | null | undefined;
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly terminalManager: TerminalManager | null;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly daemonConfigStore: DaemonConfigStore;
  private readonly agentUpdates: AgentUpdatesService;
  private readonly ottoHome: string;
  private readonly worktreesRoot: string | undefined;
  private readonly logger: pino.Logger;
  private readonly pendingStartConfirmationTokens = new Map<string, string>();

  constructor(options: RunsSessionOptions) {
    this.host = options.host;
    this.runService = options.runService;
    this.graphStore = options.graphStore;
    this.graphSharingService = options.graphSharingService ?? null;
    this.nodeOutputStore = options.nodeOutputStore;
    this.promptTemplateStore = options.promptTemplateStore;
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.terminalManager = options.terminalManager;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.daemonConfigStore = options.daemonConfigStore;
    this.agentUpdates = options.agentUpdates;
    this.ottoHome = options.ottoHome;
    this.worktreesRoot = options.worktreesRoot;
    this.logger = options.logger.child({ module: "runs-session" });
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    if (isProjectWorkflowLibraryRequest(msg)) return this.dispatchProjectWorkflowLibrary(msg);
    switch (msg.type) {
      case "runs.get_snapshot.request": {
        this.handleRunsGetSnapshotRequest(msg);
        return undefined;
      }
      case "runs.gate_respond.request": {
        this.handleRunsGateRespondRequest(msg);
        return undefined;
      }
      case "runs.cancel.request": {
        this.handleRunsCancelRequest(msg);
        return undefined;
      }
      case "runs.clear.request":
        return this.handleRunsClearRequest(msg);
      case "runs.delete.request":
        return this.handleRunsDeleteRequest(msg);
      case "runs.graphs.list.request":
        return this.handleRunsGraphsListRequest(msg);
      case "runs.graphs.save.request":
        return this.handleRunsGraphsSaveRequest(msg);
      case "runs.graphs.delete.request":
        return this.handleRunsGraphsDeleteRequest(msg);
      case "workflows.graphs.list.request":
        return this.handleWorkflowsGraphsListRequest(msg);
      case "workflows.graph.export.request":
        return this.handleWorkflowsGraphExportRequest(msg);
      case "workflows.graph.import.request":
        return this.handleWorkflowsGraphImportRequest(msg);
      case "runs.templates.list.request":
        return this.handleRunsTemplatesListRequest(msg);
      case "runs.templates.save.request":
        return this.handleRunsTemplatesSaveRequest(msg);
      case "runs.templates.delete.request":
        return this.handleRunsTemplatesDeleteRequest(msg);
      case "runs.start.request":
      case "workflows.start.request":
        return this.handleStartWorkflowRequest(msg);
      case "workflows.start_confirmation.respond.request":
        this.handleStartConfirmationRespondRequest(msg);
        return undefined;
      default:
        return undefined;
    }
  }

  private dispatchProjectWorkflowLibrary(
    msg: Extract<
      SessionInboundMessage,
      | { type: "workflows.graph.save.request" }
      | { type: "workflows.templates.list.request" }
      | { type: "workflows.template.save.request" }
      | { type: "workflows.storage.transfer.request" }
    >,
  ): Promise<void> {
    switch (msg.type) {
      case "workflows.graph.save.request":
        return this.handleWorkflowsGraphSaveRequest(msg);
      case "workflows.templates.list.request":
        return this.handleWorkflowsTemplatesListRequest(msg);
      case "workflows.template.save.request":
        return this.handleWorkflowsTemplateSaveRequest(msg);
      case "workflows.storage.transfer.request":
        return this.handleWorkflowsStorageTransferRequest(msg);
    }
  }

  private handleRunsGetSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.get_snapshot.request" }>,
  ): void {
    const runs = (this.runService?.listRuns() ?? []).map(toWireRun);
    this.host.emit({
      type: "runs.get_snapshot.response",
      payload: { runs, requestId: msg.requestId },
    });
  }

  private handleRunsGateRespondRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.gate_respond.request" }>,
  ): void {
    const accepted =
      this.runService?.respondToGate({
        runId: msg.runId,
        phaseId: msg.phaseId,
        decision: {
          approved: msg.approved,
          ...(msg.note !== undefined ? { note: msg.note } : {}),
        },
      }) ?? false;
    this.host.emit({
      type: "runs.gate_respond.response",
      payload: { runId: msg.runId, accepted, requestId: msg.requestId },
    });
  }

  private handleStartConfirmationRespondRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.start_confirmation.respond.request" }>,
  ): void {
    const accepted =
      this.runService?.respondToStartConfirmation({ runId: msg.runId, approved: msg.approved }) ??
      false;
    this.host.emit({
      type: "workflows.start_confirmation.respond.response",
      payload: { runId: msg.runId, accepted, requestId: msg.requestId },
    });
  }

  private handleRunsCancelRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.cancel.request" }>,
  ): void {
    const canceled = this.runService?.cancelRun(msg.runId) ?? false;
    this.host.emit({
      type: "runs.cancel.response",
      payload: { runId: msg.runId, canceled, requestId: msg.requestId },
    });
  }

  private async handleRunsClearRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.clear.request" }>,
  ): Promise<void> {
    const runIds = (await this.runService?.clearFinishedRuns()) ?? [];
    this.host.emit({
      type: "runs.clear.response",
      payload: { runIds, requestId: msg.requestId },
    });
  }

  private async handleRunsDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.delete.request" }>,
  ): Promise<void> {
    const result = (await this.runService?.deleteRun(msg.runId)) ?? {
      deleted: false,
      error: "Orchestration is not available on this host",
    };
    this.host.emit({
      type: "runs.delete.response",
      payload: {
        ...(result.deleted ? { runId: msg.runId } : {}),
        ...(result.error ? { error: result.error } : {}),
        requestId: msg.requestId,
      },
    });
  }

  // ── Orchestration graphs (projects/orchestration-graphs) ──────────────────

  private async handleRunsGraphsListRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.graphs.list.request" }>,
  ): Promise<void> {
    const graphs = (await this.graphStore?.list()) ?? [];
    this.host.emit({
      type: "runs.graphs.list.response",
      payload: { graphs, requestId: msg.requestId },
    });
  }

  private async handleRunsGraphsSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.graphs.save.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphStore) {
        throw new Error("Orchestration graphs are not available on this daemon.");
      }
      // A saved graph is user-owned: saving over a built-in id persists a plain
      // copy (builtIn stripped), so starter graphs are copy-on-edit.
      const { builtIn: _builtIn, ...rest } = msg.graph;
      const now = new Date().toISOString();
      const graph = {
        ...rest,
        createdAt: msg.graph.createdAt ?? now,
        updatedAt: now,
      };
      await this.graphStore.save(graph);
      this.host.emit({
        type: "runs.graphs.save.response",
        payload: { graph, requestId: msg.requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "runs.graphs.save.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleRunsGraphsDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.graphs.delete.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphStore) {
        throw new Error("Orchestration graphs are not available on this daemon.");
      }
      const existing = await this.graphStore.get(msg.graphId);
      if (existing?.builtIn) {
        throw new Error("Built-in starter graphs can't be deleted.");
      }
      await this.graphStore.delete(msg.graphId);
      this.host.emit({
        type: "runs.graphs.delete.response",
        payload: { deleted: existing !== null, requestId: msg.requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "runs.graphs.delete.response",
        payload: {
          deleted: false,
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsGraphExportRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.graph.export.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Graph sharing is not available on this daemon.");
      this.host.emit({
        type: "workflows.graph.export.response",
        payload: {
          export: await this.graphSharingService.exportGraph(msg.graphId),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.graph.export.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsGraphsListRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.graphs.list.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Project Workflow storage is not available on this daemon.");
      this.host.emit({
        type: "workflows.graphs.list.response",
        payload: {
          graphs: await this.graphSharingService.listProjectGraphs(msg.cwd),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.graphs.list.response",
        payload: {
          graphs: [],
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsGraphSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.graph.save.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Project Workflow storage is not available on this daemon.");
      this.host.emit({
        type: "workflows.graph.save.response",
        payload: {
          graph: await this.graphSharingService.saveProjectGraph(msg.cwd, msg.graph),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.graph.save.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsGraphImportRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.graph.import.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Graph sharing is not available on this daemon.");
      const result = await this.graphSharingService.importGraph({
        cwd: msg.cwd,
        exported: msg.export,
        confirmed: msg.confirmed,
      });
      this.host.emit({
        type: "workflows.graph.import.response",
        payload: { result, requestId: msg.requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.graph.import.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  // ── Prompt templates (projects/orchestration-graphs) ──────────────────────

  private async handleRunsTemplatesListRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.templates.list.request" }>,
  ): Promise<void> {
    const templates = (await this.promptTemplateStore?.list()) ?? [];
    this.host.emit({
      type: "runs.templates.list.response",
      payload: { templates, requestId: msg.requestId },
    });
  }

  private async handleRunsTemplatesSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.templates.save.request" }>,
  ): Promise<void> {
    try {
      if (!this.promptTemplateStore) {
        throw new Error("Prompt templates are not available on this daemon.");
      }
      // Copy-on-edit, exactly as graphs do: saving over a bundled template
      // persists a plain user-owned copy.
      const { builtIn: _builtIn, ...rest } = msg.template;
      const now = new Date().toISOString();
      const template = {
        ...rest,
        createdAt: msg.template.createdAt ?? now,
        updatedAt: now,
      };
      await this.promptTemplateStore.save(template);
      this.host.emit({
        type: "runs.templates.save.response",
        payload: { template, requestId: msg.requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "runs.templates.save.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleRunsTemplatesDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.templates.delete.request" }>,
  ): Promise<void> {
    try {
      if (!this.promptTemplateStore) {
        throw new Error("Prompt templates are not available on this daemon.");
      }
      const existing = await this.promptTemplateStore.get(msg.templateId);
      if (existing?.builtIn) {
        throw new Error("Bundled templates can't be deleted.");
      }
      await this.promptTemplateStore.delete(msg.templateId);
      this.host.emit({
        type: "runs.templates.delete.response",
        payload: { deleted: existing !== null, requestId: msg.requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "runs.templates.delete.response",
        payload: {
          deleted: false,
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsTemplatesListRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.templates.list.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Project Workflow storage is not available on this daemon.");
      this.host.emit({
        type: "workflows.templates.list.response",
        payload: {
          templates: await this.graphSharingService.listProjectTemplates(msg.cwd),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.templates.list.response",
        payload: {
          templates: [],
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsTemplateSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.template.save.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Project Workflow storage is not available on this daemon.");
      this.host.emit({
        type: "workflows.template.save.response",
        payload: {
          template: await this.graphSharingService.saveProjectTemplate(msg.cwd, msg.template),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.template.save.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleWorkflowsStorageTransferRequest(
    msg: Extract<SessionInboundMessage, { type: "workflows.storage.transfer.request" }>,
  ): Promise<void> {
    try {
      if (!this.graphSharingService)
        throw new Error("Project Workflow storage is not available on this daemon.");
      this.host.emit({
        type: "workflows.storage.transfer.response",
        payload: {
          receipt: await this.graphSharingService.transferProjectRecord(msg),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "workflows.storage.transfer.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleStartWorkflowRequest(
    msg: Extract<
      SessionInboundMessage,
      { type: "runs.start.request" } | { type: "workflows.start.request" }
    >,
  ): Promise<void> {
    // COMPAT(runsStartRpc): mirror the request namespace through 2027-02-28 so
    // an old client receives the exact response it knows how to parse.
    const responseType =
      msg.type === "workflows.start.request" ? "workflows.start.response" : "runs.start.response";
    try {
      if (!this.runService || !this.graphStore) {
        throw new Error("Orchestrations are not available on this daemon.");
      }
      const workflowInput = buildStartUserWorkflowInput(msg);
      const { graphStore, promptTemplateStore } = await this.resolveLaunchStores(workflowInput);
      const fingerprint = await this.redeemStartConfirmation(
        workflowInput,
        graphStore,
        msg.startConfirmationToken,
      );
      const result = await startUserOrchestration(
        {
          runService: this.runService,
          graphStore,
          agentManager: this.agentManager,
          createAgentDeps: {
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            logger: this.logger,
            ottoHome: this.ottoHome,
            ...(this.worktreesRoot ? { worktreesRoot: this.worktreesRoot } : {}),
            terminalManager: this.terminalManager,
            providerSnapshotManager: this.providerSnapshotManager,
            createOttoWorktree: (input, options) => this.host.createOttoWorktree(input, options),
            scheduleAutoTitle: (request) => this.host.scheduleAutoTitle(request),
          },
          logger: this.logger,
          getPersonalityRoster: () => this.daemonConfigStore.get().agentProfiles ?? [],
          getAgentTeams: () => this.daemonConfigStore.get().agentTeams,
          listProviderEntries: (cwd) =>
            this.providerSnapshotManager.listProviders({ cwd, wait: true }),
          ...(this.nodeOutputStore ? { nodeOutputStore: this.nodeOutputStore } : {}),
          ...(promptTemplateStore ? { promptTemplateStore } : {}),
        },
        workflowInput,
      );
      // Surface the new orchestrator chat to every client immediately (same
      // forwarding the suggested-task spawn path does), and report the
      // workspace the daemon resolved it into so the client can navigate.
      let workspaceId: string | undefined;
      if (result.agentId) {
        const snapshot = this.agentManager.getAgent(result.agentId);
        if (snapshot) {
          workspaceId = snapshot.workspaceId ?? undefined;
          await this.agentUpdates.forwardLiveAgent(snapshot);
        }
      }
      this.host.emit({
        type: responseType,
        payload: {
          ...(result.runId ? { runId: result.runId } : {}),
          ...(result.agentId ? { agentId: result.agentId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(result.confirmation ? { confirmation: result.confirmation } : {}),
          ...(result.confirmation
            ? { confirmationToken: this.issueStartConfirmationToken(fingerprint) }
            : {}),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "workflows.start failed");
      this.host.emit({
        type: responseType,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  private async resolveLaunchStores(input: StartUserOrchestrationInput): Promise<{
    graphStore: GraphStore;
    promptTemplateStore: PromptTemplateStore | null | undefined;
  }> {
    const graphStore = this.graphStore;
    if (!graphStore) throw new Error("Orchestrations are not available on this daemon.");
    if (input.flavor !== "graph" || !this.graphSharingService) {
      return { graphStore, promptTemplateStore: this.promptTemplateStore };
    }
    return {
      graphStore: await this.graphSharingService.projectGraphStore(input.cwd),
      promptTemplateStore: await this.graphSharingService.projectTemplateStore(input.cwd),
    };
  }

  /**
   * Compute the fingerprint of this exact launch (including the reviewed Graph
   * document) and, when the client presents a confirmation token, require it
   * to match before the launch may skip its start review.
   */
  private async redeemStartConfirmation(
    workflowInput: StartUserOrchestrationInput,
    graphStore: GraphStore,
    token: string | undefined,
  ): Promise<string> {
    const reviewedGraph = workflowInput.graphId
      ? await graphStore.get(workflowInput.graphId)
      : null;
    const fingerprint = workflowStartFingerprint(
      workflowInput,
      reviewedGraph ? graphHash(reviewedGraph) : null,
    );
    if (token === undefined) {
      return fingerprint;
    }
    if (this.pendingStartConfirmationTokens.get(token) !== fingerprint) {
      throw new Error(
        "This Workflow start confirmation is no longer valid. Review the Graph again.",
      );
    }
    this.pendingStartConfirmationTokens.delete(token);
    workflowInput.startConfirmationSatisfied = true;
    return fingerprint;
  }

  private issueStartConfirmationToken(fingerprint: string): string {
    const token = randomUUID();
    this.pendingStartConfirmationTokens.set(token, fingerprint);
    // A client that keeps reviewing without confirming must not grow this map
    // for the life of the session; only the newest reviews stay redeemable.
    while (this.pendingStartConfirmationTokens.size > MAX_PENDING_START_CONFIRMATIONS) {
      const oldest = this.pendingStartConfirmationTokens.keys().next().value;
      if (oldest === undefined) break;
      this.pendingStartConfirmationTokens.delete(oldest);
    }
    return token;
  }
}
