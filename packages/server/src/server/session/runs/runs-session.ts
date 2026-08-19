import type pino from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { AgentAutoTitleRequest } from "../../agent/agent-auto-title.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { GraphStore } from "../../orchestration/graph-store.js";
import type { NodeOutputStore } from "../../orchestration/node-output.js";
import type { PromptTemplateStore } from "../../orchestration/prompt-template-store.js";
import type { RunService } from "../../orchestration/run-service.js";
import {
  startUserOrchestration,
  type StartUserOrchestrationInput,
} from "../../orchestration/user-orchestration.js";
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
  runService: RunService | null | undefined;
  graphStore: GraphStore | null | undefined;
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
function buildStartUserOrchestrationInput(
  msg: Extract<SessionInboundMessage, { type: "runs.start.request" }>,
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
 * The Otto orchestration-runs session domain: run snapshot and control, graph
 * and prompt-template storage, and starting a user orchestration. Extracted
 * from `session.ts` so the dispatcher dispatches and the domain owns its own
 * logic, matching the shape Paseo uses for checkout, files, voice and the rest
 * (and the shape `session/brain/` and `session/communications/` follow).
 */
export class RunsSession {
  private readonly host: RunsSessionHost;
  private readonly runService: RunService | null | undefined;
  private readonly graphStore: GraphStore | null | undefined;
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

  constructor(options: RunsSessionOptions) {
    this.host = options.host;
    this.runService = options.runService;
    this.graphStore = options.graphStore;
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
      case "runs.templates.list.request":
        return this.handleRunsTemplatesListRequest(msg);
      case "runs.templates.save.request":
        return this.handleRunsTemplatesSaveRequest(msg);
      case "runs.templates.delete.request":
        return this.handleRunsTemplatesDeleteRequest(msg);
      case "runs.start.request":
        return this.handleRunsStartRequest(msg);
      default:
        return undefined;
    }
  }

  private handleRunsGetSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.get_snapshot.request" }>,
  ): void {
    const runs = this.runService?.listRuns() ?? [];
    this.host.emit({
      type: "runs.get_snapshot.response",
      payload: { runs, requestId: msg.requestId },
    });
  }

  private handleRunsGateRespondRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.gate_respond.request" }>,
  ): void {
    const accepted =
      this.runService?.respondToGate(msg.runId, {
        approved: msg.approved,
        ...(msg.note !== undefined ? { note: msg.note } : {}),
      }) ?? false;
    this.host.emit({
      type: "runs.gate_respond.response",
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

  private async handleRunsStartRequest(
    msg: Extract<SessionInboundMessage, { type: "runs.start.request" }>,
  ): Promise<void> {
    try {
      if (!this.runService || !this.graphStore) {
        throw new Error("Orchestrations are not available on this daemon.");
      }
      const result = await startUserOrchestration(
        {
          runService: this.runService,
          graphStore: this.graphStore,
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
          getPersonalityRoster: () =>
            this.daemonConfigStore.get().agentPersonalities?.personalities ?? [],
          getAgentTeams: () => this.daemonConfigStore.get().agentTeams,
          listProviderEntries: (cwd) =>
            this.providerSnapshotManager.listProviders({ cwd, wait: true }),
          ...(this.nodeOutputStore ? { nodeOutputStore: this.nodeOutputStore } : {}),
          ...(this.promptTemplateStore ? { promptTemplateStore: this.promptTemplateStore } : {}),
        },
        buildStartUserOrchestrationInput(msg),
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
        type: "runs.start.response",
        payload: {
          ...(result.runId ? { runId: result.runId } : {}),
          ...(result.agentId ? { agentId: result.agentId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "runs.start failed");
      this.host.emit({
        type: "runs.start.response",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          requestId: msg.requestId,
        },
      });
    }
  }
}
