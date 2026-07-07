import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { ArtifactStore } from "./artifact-store.js";
import { ArtifactWatcher } from "./artifact-watcher.js";
import { ARTIFACT_SYSTEM_PROMPT } from "./artifact-prompt.js";
import type { CreateArtifactInput } from "@otto-code/protocol/artifacts/types";

export type { CreateArtifactInput };

interface ArtifactServiceOptions {
  projectCwd: string;
  logger: Logger;
  agentManager: AgentManager;
  broadcastArtifactUpdate: (metadata: ArtifactMetadata) => void;
}

class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact "${artifactId}" not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactService {
  private readonly store: ArtifactStore;
  private readonly watcher: ArtifactWatcher;
  private readonly projectCwd: string;
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly broadcastArtifactUpdate: (metadata: ArtifactMetadata) => void;

  constructor(options: ArtifactServiceOptions) {
    this.projectCwd = options.projectCwd;
    this.store = new ArtifactStore(options.projectCwd);
    this.logger = options.logger.child({ module: "artifact-service" });
    this.agentManager = options.agentManager;
    this.broadcastArtifactUpdate = options.broadcastArtifactUpdate;
    this.watcher = new ArtifactWatcher({
      store: this.store,
      logger: this.logger,
      sendNotification: (metadata: ArtifactMetadata) => {
        this.broadcastArtifactUpdate(metadata);
      },
    });
  }

  async list(projectId?: string): Promise<ArtifactMetadata[]> {
    return this.store.list(projectId ? { projectId } : undefined);
  }

  async delete(artifactId: string): Promise<void> {
    this.watcher.unwatch(artifactId);
    await this.store.delete(artifactId);
  }

  stop(): void {
    this.watcher.stop();
  }

  async star(artifactId: string, starred: boolean): Promise<ArtifactMetadata> {
    const existing = await this.store.get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }
    await this.store.update(artifactId, { starred });
    const updated = await this.store.get(artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return updated;
  }

  async getContent(artifactId: string): Promise<string> {
    const metadata = await this.store.get(artifactId);
    if (!metadata) {
      throw new ArtifactNotFoundError(artifactId);
    }
    try {
      return await readFile(this.resolveHtmlPath(artifactId), "utf-8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Artifact HTML not found for "${artifactId}"`, { cause: error });
      }
      throw error;
    }
  }

  async create(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const artifactId = generateArtifactId();
    const now = new Date().toISOString();
    const filePath = this.resolveHtmlPath(artifactId);
    const metadata: ArtifactMetadata = {
      id: artifactId,
      name: input.name,
      description: input.description,
      projectId: input.projectId ?? "",
      filePath,
      kind: "html",
      status: "generating",
      starred: false,
      createdAt: now,
      updatedAt: now,
      generationAgentId: null,
      generationProvider: input.provider,
      generationModel: input.model ?? null,
      errorMessage: null,
    };

    await this.store.create(metadata);
    this.watcher.watch(artifactId, filePath);
    void this.spawnArtifactAgent(artifactId, metadata, input).catch((error) => {
      this.logger.error({ err: error, artifactId }, "Failed to spawn artifact agent");
      void this.store.update(artifactId, { status: "error", errorMessage: String(error) });
    });

    return metadata;
  }

  private async spawnArtifactAgent(
    artifactId: string,
    metadata: ArtifactMetadata,
    input: CreateArtifactInput,
  ): Promise<void> {
    const htmlPath = this.resolveHtmlPath(artifactId);

    const agentPrompt = `${metadata.description}\n\nWrite the HTML file to: ${htmlPath}`;

    const config: AgentSessionConfig = {
      provider: input.provider,
      model: input.model,
      modeId: input.modeId,
      thinkingOptionId: input.thinkingOptionId,
      systemPrompt: ARTIFACT_SYSTEM_PROMPT,
      cwd: this.projectCwd,
      internal: true,
      title: metadata.name,
    };

    await this.agentManager.createAgent(config, undefined, {
      initialPrompt: agentPrompt,
      initialTitle: metadata.name,
    });
  }

  private resolveHtmlPath(artifactId: string): string {
    return join(this.projectCwd, ".otto", "artifacts", `${artifactId}.html`);
  }
}

function generateArtifactId(): string {
  return randomBytes(4).toString("hex");
}
