import type pino from "pino";
import type { FirstAgentContext } from "@otto-code/protocol/messages";

import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type { StructuredGenerationDaemonConfig } from "./structured-generation-providers.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import { generateAgentTitleFromFirstAgentContext } from "./agent-title-generator.js";

type AgentTitleGenerator = typeof generateAgentTitleFromFirstAgentContext;

type CurrentSelection = {
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
} | null;

export interface AgentAutoTitleRequest {
  agentId: string;
  cwd: string;
  firstAgentContext: FirstAgentContext;
  /**
   * The deterministic first-line title the chat was created with. The AI title
   * only replaces this exact value — a user rename or an explicit caller-set
   * title (which never equals the provisional) is left untouched.
   */
  provisionalTitle: string | null;
  currentSelection?: CurrentSelection;
}

interface AgentAutoTitleOptions {
  agentManager: AgentManager;
  agentStorage: Pick<AgentStorage, "get">;
  providerSnapshotManager: ProviderSnapshotManager;
  readDaemonConfig: () => StructuredGenerationDaemonConfig;
  workspaceGitService: Pick<WorkspaceGitService, "resolveRepoRoot">;
  logger: pino.Logger;
  generateAgentTitle?: AgentTitleGenerator;
}

/**
 * Writes a short, human-friendly chat title from the first message of a new
 * chat, replacing the provisional first-line-of-prompt title. Runs off the
 * create hot path (scheduled on the next tick) and is best-effort — a failed or
 * empty generation just leaves the provisional title in place.
 *
 * Mirrors {@link WorkspaceAutoName} for agents: workspaces get an AI title from
 * the same first-agent context; a chat is the per-conversation equivalent, kept
 * even shorter (1–3 words) because it renders in the chat list and the
 * visualizer tab strip.
 */
export class AgentAutoTitle {
  private readonly agentManager: AgentManager;
  private readonly agentStorage: Pick<AgentStorage, "get">;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly readDaemonConfig: () => StructuredGenerationDaemonConfig;
  private readonly workspaceGitService: Pick<WorkspaceGitService, "resolveRepoRoot">;
  private readonly logger: pino.Logger;
  private readonly generateAgentTitle: AgentTitleGenerator;

  constructor(options: AgentAutoTitleOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.readDaemonConfig = options.readDaemonConfig;
    this.workspaceGitService = options.workspaceGitService;
    this.logger = options.logger;
    this.generateAgentTitle = options.generateAgentTitle ?? generateAgentTitleFromFirstAgentContext;
  }

  schedule(request: AgentAutoTitleRequest): void {
    setTimeout(() => {
      void this.run(request).catch((error) => {
        this.logger.warn(
          { err: error, agentId: request.agentId, cwd: request.cwd },
          "Failed to auto-name chat",
        );
      });
    }, 0);
  }

  private async run(request: AgentAutoTitleRequest): Promise<void> {
    const generated = await this.generateAgentTitle({
      agentManager: this.agentManager,
      cwd: request.cwd,
      workspaceGitService: this.workspaceGitService,
      providerSnapshotManager: this.providerSnapshotManager,
      daemonConfig: this.readDaemonConfig(),
      currentSelection: request.currentSelection ?? undefined,
      firstAgentContext: request.firstAgentContext,
      logger: this.logger,
    });
    const title = generated?.trim();
    if (!title) {
      return;
    }

    // Re-read the stored title before writing: only overwrite the provisional
    // first-line title. If the chat was renamed (by the user or an explicit
    // caller title) between creation and now, its title no longer equals the
    // provisional, so leave it alone.
    const current = await this.agentStorage.get(request.agentId);
    if (!current) {
      return;
    }
    const currentTitle = current.title ?? null;
    if (currentTitle && currentTitle !== request.provisionalTitle) {
      return;
    }
    if (currentTitle === title) {
      return;
    }
    await this.agentManager.setTitle(request.agentId, title);
  }
}
