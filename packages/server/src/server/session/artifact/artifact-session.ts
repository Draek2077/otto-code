import type { Logger } from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ArtifactMetadata, CreateArtifactInput } from "@otto-code/protocol/artifacts/types";
import { ArtifactService } from "../../artifact/artifact-service.js";

export interface ArtifactSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ArtifactSessionOptions {
  host: ArtifactSessionHost;
  artifactService: ArtifactService;
  logger: Logger;
}

export class ArtifactSession {
  private readonly host: ArtifactSessionHost;
  private readonly artifactService: ArtifactService;
  private readonly logger: Logger;

  constructor(options: ArtifactSessionOptions) {
    this.host = options.host;
    this.artifactService = options.artifactService;
    this.logger = options.logger.child({ module: "artifact-session" });
  }

  async handleArtifactListRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.list.request" }>,
  ): Promise<void> {
    try {
      const artifacts = await this.artifactService.list(msg.projectId);
      this.host.emit({
        type: "artifact.list.response",
        payload: {
          artifacts,
          success: true,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to list artifacts");
      this.host.emit({
        type: "artifact.list.response",
        payload: {
          artifacts: [],
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.create.request" }>,
  ): Promise<void> {
    try {
      const input: CreateArtifactInput = {
        name: msg.name,
        description: msg.description,
        projectId: msg.projectId,
        provider: msg.provider,
        model: msg.model,
        modeId: msg.modeId,
        thinkingOptionId: msg.thinkingOptionId,
      };
      const artifact = await this.artifactService.create(input);
      this.host.emit({
        type: "artifact.create.response",
        payload: {
          artifact,
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.created.notification",
        payload: {
          artifact,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to create artifact");
      this.host.emit({
        type: "artifact.create.response",
        payload: {
          artifact: this.createEmptyArtifact(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.update.request" }>,
  ): Promise<void> {
    try {
      const artifact = await this.artifactService.update({
        artifactId: msg.artifactId,
        name: msg.name,
        description: msg.description,
        projectId: msg.projectId,
        provider: msg.provider,
        model: msg.model,
      });
      this.host.emit({
        type: "artifact.update.response",
        payload: {
          artifact,
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.updated.notification",
        payload: {
          artifact,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to update artifact");
      this.host.emit({
        type: "artifact.update.response",
        payload: {
          artifact: this.createEmptyArtifact(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactRegenerateRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.regenerate.request" }>,
  ): Promise<void> {
    try {
      const artifact = await this.artifactService.regenerate(msg.artifactId);
      this.host.emit({
        type: "artifact.regenerate.response",
        payload: {
          artifact,
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.updated.notification",
        payload: {
          artifact,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to regenerate artifact");
      this.host.emit({
        type: "artifact.regenerate.response",
        payload: {
          artifact: this.createEmptyArtifact(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactCancelRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.cancel.request" }>,
  ): Promise<void> {
    try {
      const artifact = await this.artifactService.cancel(msg.artifactId);
      this.host.emit({
        type: "artifact.cancel.response",
        payload: {
          artifact,
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.updated.notification",
        payload: {
          artifact,
        },
      });
    } catch (error) {
      this.logger.error(
        { error, requestId: msg.requestId },
        "Failed to cancel artifact generation",
      );
      this.host.emit({
        type: "artifact.cancel.response",
        payload: {
          artifact: this.createEmptyArtifact(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.delete.request" }>,
  ): Promise<void> {
    try {
      await this.artifactService.delete(msg.artifactId);
      this.host.emit({
        type: "artifact.delete.response",
        payload: {
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.deleted.notification",
        payload: {
          artifactId: msg.artifactId,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to delete artifact");
      this.host.emit({
        type: "artifact.delete.response",
        payload: {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactStarRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.star.request" }>,
  ): Promise<void> {
    try {
      const artifact = await this.artifactService.star(msg.artifactId, msg.starred);
      this.host.emit({
        type: "artifact.star.response",
        payload: {
          artifact,
          success: true,
          requestId: msg.requestId,
        },
      });
      this.host.emit({
        type: "artifact.updated.notification",
        payload: {
          artifact,
        },
      });
    } catch (error) {
      this.logger.error(
        { error, requestId: msg.requestId },
        "Failed to update artifact star status",
      );
      this.host.emit({
        type: "artifact.star.response",
        payload: {
          artifact: this.createEmptyArtifact(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleArtifactGetContentRequest(
    msg: Extract<SessionInboundMessage, { type: "artifact.get-content.request" }>,
  ): Promise<void> {
    try {
      const content = await this.artifactService.getContent(msg.artifactId);
      this.host.emit({
        type: "artifact.get-content.response",
        payload: {
          content,
          success: true,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ error, requestId: msg.requestId }, "Failed to get artifact content");
      this.host.emit({
        type: "artifact.get-content.response",
        payload: {
          content: "",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          requestId: msg.requestId,
        },
      });
    }
  }

  async startWatchingGeneratingArtifacts(): Promise<void> {
    try {
      const artifacts = await this.artifactService.list();
      const generating = artifacts.filter((a: ArtifactMetadata) => a.status === "generating");
      if (generating.length > 0) {
        this.logger.info(
          { count: generating.length },
          "Found artifacts with generating status from previous session",
        );
      }
    } catch (error) {
      this.logger.warn({ error }, "Failed to scan for generating artifacts on startup");
    }
  }

  stop(): void {
    this.artifactService.stop();
  }

  private createEmptyArtifact(): ArtifactMetadata {
    return {
      id: "",
      name: "",
      description: "",
      projectId: "",
      filePath: "",
      kind: "html",
      status: "error",
      starred: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generationAgentId: null,
      generationProvider: "",
      generationModel: null,
      errorMessage: null,
    };
  }
}
