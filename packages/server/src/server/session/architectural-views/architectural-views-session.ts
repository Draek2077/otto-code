import type { Logger } from "pino";
import { isAbsolute, resolve, sep } from "node:path";
import type { ProjectKnowledgeStoreResolver } from "../../agent/project-knowledge/project-knowledge-store-resolver.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import {
  ArchitecturalViewsService,
  type ArchitecturalViewDraft,
  type ArchitecturalViewSummary,
  type ArchitecturalViewKnowledgeReference,
} from "../../architectural-views/architectural-views-service.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

export interface ArchitecturalViewsSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ArchitecturalViewsSessionOptions {
  host: ArchitecturalViewsSessionHost;
  workspaceRegistry: WorkspaceRegistry;
  projectKnowledgeStores: ProjectKnowledgeStoreResolver | null | undefined;
  logger: Logger;
}

/** Daemon RPC boundary for Knowledge-packaged Architectural Views. */
export class ArchitecturalViewsSession {
  private readonly host: ArchitecturalViewsSessionHost;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly projectKnowledgeStores: ProjectKnowledgeStoreResolver | null | undefined;
  private readonly logger: Logger;

  constructor(options: ArchitecturalViewsSessionOptions) {
    this.host = options.host;
    this.workspaceRegistry = options.workspaceRegistry;
    this.projectKnowledgeStores = options.projectKnowledgeStores;
    this.logger = options.logger.child({ module: "architectural-views-session" });
  }

  async handleDeliverRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.deliver.request" }>,
  ): Promise<void> {
    const respond = (input: {
      success: boolean;
      storeLocation: "repository" | "host" | null;
      htmlPath: string | null;
      error: string | null;
    }): void => {
      this.host.emit({
        type: "architectural-views.deliver.response",
        payload: { requestId: msg.requestId, viewId: msg.viewId, ...input },
      });
    };

    const resolver = this.projectKnowledgeStores;
    if (!resolver) {
      respond({
        success: false,
        storeLocation: null,
        htmlPath: null,
        error: "This host does not support Knowledge-packaged Architectural Views.",
      });
      return;
    }

    const workspace = await this.workspaceRegistry.get(msg.workspaceId);
    if (!workspace) {
      respond({
        success: false,
        storeLocation: null,
        htmlPath: null,
        error: "Workspace not found.",
      });
      return;
    }

    const sourcePath = resolve(workspace.cwd, msg.sourcePath);
    if (isAbsolute(msg.sourcePath) || !isPathWithinRoot(workspace.cwd, sourcePath)) {
      respond({
        success: false,
        storeLocation: null,
        htmlPath: null,
        error: "Architectural View source must stay inside its workspace.",
      });
      return;
    }

    try {
      const service = new ArchitecturalViewsService({
        resolveStore: (cwd) => resolver.resolveForCwd(cwd),
      });
      const result = await service.deliver({
        cwd: workspace.cwd,
        viewId: msg.viewId,
        title: msg.title,
        knowledgeReferences: msg.knowledgeReferences as ArchitecturalViewKnowledgeReference[],
        sourcePath: sourcePath!,
        quality: msg.quality,
      });
      respond({
        success: true,
        storeLocation: result.storeLocation,
        htmlPath: result.htmlPath,
        error: null,
      });
    } catch (error) {
      this.logger.error({ error, viewId: msg.viewId }, "Failed to deliver Architectural View");
      respond({
        success: false,
        storeLocation: null,
        htmlPath: null,
        error: error instanceof Error ? error.message : "Failed to deliver Architectural View.",
      });
    }
  }

  async handleListRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.list.request" }>,
  ): Promise<void> {
    const workspace = await this.workspaceRegistry.get(msg.workspaceId);
    if (!workspace) {
      this.host.emit({
        type: "architectural-views.list.response",
        payload: {
          requestId: msg.requestId,
          success: false,
          views: [],
          error: "Workspace not found.",
        },
      });
      return;
    }
    const resolver = this.projectKnowledgeStores;
    if (!resolver) {
      this.host.emit({
        type: "architectural-views.list.response",
        payload: {
          requestId: msg.requestId,
          success: false,
          views: [],
          error: "This host does not support Knowledge-packaged Architectural Views.",
        },
      });
      return;
    }
    try {
      const views = await this.service(resolver).list(workspace.cwd, msg.knowledgeReference);
      this.host.emit({
        type: "architectural-views.list.response",
        payload: { requestId: msg.requestId, success: true, views, error: null },
      });
    } catch (error) {
      this.logger.error({ error }, "Failed to list Architectural Views");
      this.host.emit({
        type: "architectural-views.list.response",
        payload: {
          requestId: msg.requestId,
          success: false,
          views: [],
          error: error instanceof Error ? error.message : "Failed to list Architectural Views.",
        },
      });
    }
  }

  async handleGetContentRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.get-content.request" }>,
  ): Promise<void> {
    const workspace = await this.workspaceRegistry.get(msg.workspaceId);
    if (!workspace) {
      this.respondGetContent(msg.requestId, false, null, null, "Workspace not found.");
      return;
    }
    const resolver = this.projectKnowledgeStores;
    if (!resolver) {
      this.respondGetContent(
        msg.requestId,
        false,
        null,
        null,
        "This host does not support Knowledge-packaged Architectural Views.",
      );
      return;
    }
    try {
      const content = await this.service(resolver).getContent(workspace.cwd, msg.viewId);
      if (!content) {
        this.respondGetContent(msg.requestId, false, null, null, "Architectural View not found.");
        return;
      }
      this.respondGetContent(msg.requestId, true, content.view, content.html, null);
    } catch (error) {
      this.logger.error({ error, viewId: msg.viewId }, "Failed to read Architectural View");
      this.respondGetContent(
        msg.requestId,
        false,
        null,
        null,
        error instanceof Error ? error.message : "Failed to read Architectural View.",
      );
    }
  }

  async handleDraftCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.draft.create.request" }>,
  ): Promise<void> {
    const context = await this.authoringContext(msg.workspaceId);
    if (!context) {
      this.respondDraftCreate(
        msg.requestId,
        false,
        null,
        "Workspace or Architectural Views support is unavailable.",
      );
      return;
    }
    const sourcePath = msg.sourcePath ? resolve(context.cwd, msg.sourcePath) : undefined;
    if (
      msg.sourcePath &&
      (isAbsolute(msg.sourcePath) || !isPathWithinRoot(context.cwd, sourcePath!))
    ) {
      this.respondDraftCreate(
        msg.requestId,
        false,
        null,
        "Architectural View source must stay inside its workspace.",
      );
      return;
    }
    try {
      const draft = await this.service(context.resolver).createDraft({
        cwd: context.cwd,
        viewId: msg.viewId,
        draftId: msg.draftId,
        title: msg.title,
        knowledgeReferences: msg.knowledgeReferences as ArchitecturalViewKnowledgeReference[],
        ...(sourcePath ? { sourcePath } : {}),
        ...(msg.quality ? { quality: msg.quality } : {}),
      });
      this.respondDraftCreate(msg.requestId, true, draft, null);
    } catch (error) {
      this.respondDraftCreate(msg.requestId, false, null, messageFor(error));
    }
  }

  async handleDraftPublishRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.draft.publish.request" }>,
  ): Promise<void> {
    const context = await this.authoringContext(msg.workspaceId);
    if (!context) {
      this.respondDraftPublish(
        msg.requestId,
        false,
        null,
        "Workspace or Architectural Views support is unavailable.",
      );
      return;
    }
    try {
      const view = await this.service(context.resolver).publishDraft({ ...msg, cwd: context.cwd });
      this.respondDraftPublish(msg.requestId, true, view, null);
    } catch (error) {
      this.respondDraftPublish(msg.requestId, false, null, messageFor(error));
    }
  }

  async handleDraftUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.draft.update.request" }>,
  ): Promise<void> {
    const context = await this.authoringContext(msg.workspaceId);
    const sourcePath = context ? resolve(context.cwd, msg.sourcePath) : null;
    if (!context || isAbsolute(msg.sourcePath) || !isPathWithinRoot(context.cwd, sourcePath!)) {
      this.host.emit({
        type: "architectural-views.draft.update.response",
        payload: {
          requestId: msg.requestId,
          success: false,
          draft: null,
          error: "Architectural View source must stay inside its workspace.",
        },
      });
      return;
    }
    try {
      const draft = await this.service(context.resolver).updateDraft({
        cwd: context.cwd,
        viewId: msg.viewId,
        draftId: msg.draftId,
        sourcePath: sourcePath!,
        ...(msg.quality ? { quality: msg.quality } : {}),
      });
      this.host.emit({
        type: "architectural-views.draft.update.response",
        payload: { requestId: msg.requestId, success: true, draft, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "architectural-views.draft.update.response",
        payload: {
          requestId: msg.requestId,
          success: false,
          draft: null,
          error: messageFor(error),
        },
      });
    }
  }

  async handleDraftDiscardRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.draft.discard.request" }>,
  ): Promise<void> {
    const context = await this.authoringContext(msg.workspaceId);
    if (!context) {
      this.respondDraftDiscard(
        msg.requestId,
        false,
        "Workspace or Architectural Views support is unavailable.",
      );
      return;
    }
    try {
      await this.service(context.resolver).discardDraft({ ...msg, cwd: context.cwd });
      this.respondDraftDiscard(msg.requestId, true, null);
    } catch (error) {
      this.respondDraftDiscard(msg.requestId, false, messageFor(error));
    }
  }

  async handleDraftGetContentRequest(
    msg: Extract<SessionInboundMessage, { type: "architectural-views.draft.get-content.request" }>,
  ): Promise<void> {
    const context = await this.authoringContext(msg.workspaceId);
    if (!context) {
      this.respondDraftGetContent(
        msg.requestId,
        false,
        null,
        null,
        "Workspace or Architectural Views support is unavailable.",
      );
      return;
    }
    try {
      const content = await this.service(context.resolver).getDraftContent(
        context.cwd,
        msg.viewId,
        msg.draftId,
      );
      if (!content) {
        this.respondDraftGetContent(
          msg.requestId,
          false,
          null,
          null,
          "Architectural View draft not found.",
        );
        return;
      }
      this.respondDraftGetContent(msg.requestId, true, content.draft, content.html, null);
    } catch (error) {
      this.respondDraftGetContent(msg.requestId, false, null, null, messageFor(error));
    }
  }

  async bindDraftAuthoringAgent(input: {
    workspaceId: string;
    viewId: string;
    draftId: string;
    agentId: string;
  }): Promise<void> {
    const context = await this.authoringContext(input.workspaceId);
    if (!context) throw new Error("Workspace or Architectural Views support is unavailable.");
    await this.service(context.resolver).bindDraftAuthoringAgent({ ...input, cwd: context.cwd });
  }

  private service(resolver: ProjectKnowledgeStoreResolver): ArchitecturalViewsService {
    return new ArchitecturalViewsService({ resolveStore: (cwd) => resolver.resolveForCwd(cwd) });
  }

  private respondGetContent(
    requestId: string,
    success: boolean,
    view: ArchitecturalViewSummary | null,
    html: string | null,
    error: string | null,
  ): void {
    this.host.emit({
      type: "architectural-views.get-content.response",
      payload: { requestId, success, view, html, error },
    });
  }

  private async authoringContext(
    workspaceId: string,
  ): Promise<{ cwd: string; resolver: ProjectKnowledgeStoreResolver } | null> {
    const resolver = this.projectKnowledgeStores;
    const workspace = await this.workspaceRegistry.get(workspaceId);
    return resolver && workspace ? { cwd: workspace.cwd, resolver } : null;
  }

  private respondDraftCreate(
    requestId: string,
    success: boolean,
    draft: ArchitecturalViewDraft | null,
    error: string | null,
  ): void {
    this.host.emit({
      type: "architectural-views.draft.create.response",
      payload: { requestId, success, draft, error },
    });
  }

  private respondDraftPublish(
    requestId: string,
    success: boolean,
    view: ArchitecturalViewSummary | null,
    error: string | null,
  ): void {
    this.host.emit({
      type: "architectural-views.draft.publish.response",
      payload: { requestId, success, view, error },
    });
  }

  private respondDraftDiscard(requestId: string, success: boolean, error: string | null): void {
    this.host.emit({
      type: "architectural-views.draft.discard.response",
      payload: { requestId, success, error },
    });
  }

  private respondDraftGetContent(
    requestId: string,
    success: boolean,
    draft: ArchitecturalViewDraft | null,
    html: string | null,
    error: string | null,
  ): void {
    this.host.emit({
      type: "architectural-views.draft.get-content.response",
      payload: { requestId, success, draft, html, error },
    });
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Architectural View draft operation failed.";
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(root + sep);
}
