import {
  type ContextManagementService,
  resolveProjectRootForCwd,
} from "../../agent/context-management/context-management-service.js";
import type { ProjectKnowledgeService } from "../../agent/project-knowledge/project-knowledge-service.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";

/**
 * Everything the project-knowledge RPCs need from the owning session: the wire,
 * and the context-report push that the Context Management domain owns (a
 * knowledge edit changes the fixed context weight, so the session re-scans and
 * pushes the report after every mutation).
 */
export interface ProjectKnowledgeSessionHost {
  emit(msg: SessionOutboundMessage): void;
  pushContextReport(workspaceId: string): Promise<void>;
}

export interface ProjectKnowledgeSessionOptions {
  host: ProjectKnowledgeSessionHost;
  projectKnowledge: ProjectKnowledgeService | null | undefined;
  contextManagement: ContextManagementService;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: WorkspaceGitService;
}

/**
 * The Otto project-knowledge session domain: the project.knowledge.* list, get,
 * create, apply, status and delete RPCs over the daemon-owned
 * ProjectKnowledgeService. Extracted from `session.ts` so the dispatcher
 * dispatches and the domain owns its own logic, matching the shape Paseo uses
 * for checkout, files, voice and the rest (and the shape `session/brain/`,
 * `session/communications/` and `session/runs/` follow). Paseo's own
 * `session/project-config/` is left alone: this is a sibling, not an addition.
 */
export class ProjectKnowledgeSession {
  private readonly host: ProjectKnowledgeSessionHost;
  private readonly projectKnowledge: ProjectKnowledgeService | null | undefined;
  private readonly contextManagement: ContextManagementService;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceGitService: WorkspaceGitService;

  constructor(options: ProjectKnowledgeSessionOptions) {
    this.host = options.host;
    this.projectKnowledge = options.projectKnowledge;
    this.contextManagement = options.contextManagement;
    this.workspaceRegistry = options.workspaceRegistry;
    this.projectRegistry = options.projectRegistry;
    this.workspaceGitService = options.workspaceGitService;
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "project.knowledge.list.request":
        return this.handleProjectKnowledgeListRequest(msg);
      case "project.knowledge.get.request":
        return this.handleProjectKnowledgeGetRequest(msg);
      case "project.knowledge.create.request":
        return this.handleProjectKnowledgeCreateRequest(msg);
      case "project.knowledge.apply.request":
        return this.handleProjectKnowledgeApplyRequest(msg);
      case "project.knowledge.status.request":
        return this.handleProjectKnowledgeStatusRequest(msg);
      case "project.knowledge.project.apply.request":
        return this.handleProjectKnowledgeProjectApplyRequest(msg);
      case "project.knowledge.reference.apply.request":
        return this.handleProjectKnowledgeReferenceApplyRequest(msg);
      case "project.knowledge.root.apply.request":
        return this.handleProjectKnowledgeRootApplyRequest(msg);
      case "project.knowledge.delete.request":
        return this.handleProjectKnowledgeDeleteRequest(msg);
      default:
        return undefined;
    }
  }

  private async projectKnowledgeCwd(workspaceId: string): Promise<string | null> {
    return (await this.workspaceRegistry.get(workspaceId))?.cwd ?? null;
  }
  private async projectKnowledgeRoot(workspaceId: string): Promise<string | null> {
    const workspace = await this.workspaceRegistry.get(workspaceId);
    if (!workspace) return null;
    const project = await this.projectRegistry.get(workspace.projectId);
    return (
      project?.rootPath ??
      (await resolveProjectRootForCwd(workspace.cwd, (cwd) =>
        this.workspaceGitService.resolveRepoRoot(cwd),
      ))
    );
  }
  private async handleProjectKnowledgeListRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.list.request" }>,
  ): Promise<void> {
    const root = await this.projectKnowledgeRoot(msg.workspaceId);
    if (!this.projectKnowledge || !root) {
      this.host.emit({
        type: "project.knowledge.list.response",
        payload: {
          requestId: msg.requestId,
          records: [],
          rootPages: [],
          findings: [],
          brief: "",
          briefTokens: 0,
          includedIds: [],
          omittedCount: 0,
        },
      });
      return;
    }
    const view = await this.projectKnowledge.catalogViewAtRoot(root);
    this.host.emit({
      type: "project.knowledge.list.response",
      payload: {
        requestId: msg.requestId,
        // Full Markdown and timeline stay pull-on-demand through get. A real
        // charter corpus is otherwise large enough to time out the list RPC.
        records: view.records,
        rootPages: view.rootPages,
        findings: view.findings,
        brief: view.brief.text,
        briefTokens: view.brief.estTokens,
        includedIds: view.brief.includedIds,
        omittedCount: view.brief.omittedCount,
      },
    });
  }
  private async handleProjectKnowledgeGetRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.get.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    this.host.emit({
      type: "project.knowledge.get.response",
      payload: {
        requestId: msg.requestId,
        record:
          this.projectKnowledge && cwd
            ? await this.projectKnowledge.get(cwd, msg.id, { includeInactive: true })
            : null,
      },
    });
  }
  private async handleProjectKnowledgeCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.create.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const record = await this.projectKnowledge.record({
      cwd,
      ...(msg.id ? { id: msg.id } : {}),
      kind: msg.kind,
      title: msg.title,
      statement: msg.statement,
      ...(msg.evidence ? { evidence: msg.evidence } : {}),
      ...(msg.tags ? { tags: msg.tags } : {}),
      ...(msg.affects ? { affects: msg.affects } : {}),
      ...(msg.status ? { status: msg.status } : {}),
      ...(msg.deliveryStatus ? { deliveryStatus: msg.deliveryStatus } : {}),
      ...(msg.progress ? { progress: msg.progress } : {}),
      ...(msg.referenceDisposition ? { referenceDisposition: msg.referenceDisposition } : {}),
      ...(msg.sourceUrl ? { sourceUrl: msg.sourceUrl } : {}),
    });
    this.contextManagement.invalidate(msg.workspaceId);
    await this.host.pushContextReport(msg.workspaceId);
    this.host.emit({
      type: "project.knowledge.create.response",
      payload: { requestId: msg.requestId, record },
    });
  }
  private async handleProjectKnowledgeApplyRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.apply.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const result =
      msg.statement !== undefined
        ? await this.projectKnowledge.updateTruth({
            cwd,
            id: msg.id,
            statement: msg.statement,
            reason: msg.provenanceText ?? "",
            ...(msg.provenanceSource ? { source: msg.provenanceSource } : {}),
            ...(msg.provenanceAffects ? { affects: msg.provenanceAffects } : {}),
            ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
          })
        : await this.projectKnowledge.applyReviewedMutation({
            cwd,
            id: msg.id,
            ...(msg.title !== undefined ? { title: msg.title } : {}),
            ...(msg.evidence !== undefined ? { evidence: msg.evidence } : {}),
            ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
          });
    if (result.record) {
      this.contextManagement.invalidate(msg.workspaceId);
      await this.host.pushContextReport(msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.apply.response",
      payload: {
        requestId: msg.requestId,
        record: result.record,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }
  private async handleProjectKnowledgeStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.status.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const record = await this.projectKnowledge.setStatus(cwd, msg.id, msg.status, msg.reason);
    if (record) {
      this.contextManagement.invalidate(msg.workspaceId);
      await this.host.pushContextReport(msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.status.response",
      payload: { requestId: msg.requestId, record },
    });
  }
  private async handleProjectKnowledgeProjectApplyRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.project.apply.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const result = await this.projectKnowledge.updateProject({
      cwd,
      id: msg.id,
      ...(msg.deliveryStatus ? { deliveryStatus: msg.deliveryStatus } : {}),
      ...(msg.progress !== undefined ? { progress: msg.progress } : {}),
      reason: msg.reason,
      ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
    });
    if (result.record) {
      this.contextManagement.invalidate(msg.workspaceId);
      await this.host.pushContextReport(msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.project.apply.response",
      payload: {
        requestId: msg.requestId,
        record: result.record,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }
  private async handleProjectKnowledgeReferenceApplyRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.reference.apply.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const result = await this.projectKnowledge.updateReference({
      cwd,
      id: msg.id,
      ...(msg.disposition ? { disposition: msg.disposition } : {}),
      ...(msg.sourceUrl !== undefined ? { sourceUrl: msg.sourceUrl } : {}),
      reason: msg.reason,
      ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
    });
    if (result.record) {
      this.contextManagement.invalidate(msg.workspaceId);
      await this.host.pushContextReport(msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.reference.apply.response",
      payload: {
        requestId: msg.requestId,
        record: result.record,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }
  private async handleProjectKnowledgeRootApplyRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.root.apply.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const page = await this.projectKnowledge.updateRoot({ cwd, slug: msg.slug, body: msg.body });
    this.contextManagement.invalidate(msg.workspaceId);
    await this.host.pushContextReport(msg.workspaceId);
    this.host.emit({
      type: "project.knowledge.root.apply.response",
      payload: { requestId: msg.requestId, page },
    });
  }
  private async handleProjectKnowledgeDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.delete.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    const result = await this.projectKnowledge.delete({
      cwd,
      id: msg.id,
      reason: msg.reason,
      ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
    });
    if (result.deleted) {
      this.contextManagement.invalidate(msg.workspaceId);
      await this.host.pushContextReport(msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.delete.response",
      payload: { requestId: msg.requestId, ...result },
    });
  }
}
