import {
  type ContextManagementService,
  resolveProjectRootForCwd,
} from "../../agent/context-management/context-management-service.js";
import type { ProjectKnowledgeService } from "../../agent/project-knowledge/project-knowledge-service.js";
import type { ProjectKnowledgeStoreResolver } from "../../agent/project-knowledge/project-knowledge-store-resolver.js";
import type {
  ProjectKnowledgeStore,
  ProjectKnowledgeStoreLocation,
} from "../../agent/project-knowledge/project-knowledge-store.js";
import { storeHasPages } from "../../agent/project-knowledge/project-knowledge-store-migration.js";
import type { ProjectKnowledgeStoreDescriptor } from "@otto-code/protocol/messages";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import {
  KnowledgeRefinementError,
  type KnowledgeRefinementGenerator,
} from "./knowledge-refinement-generator.js";

/**
 * Everything the project-knowledge RPCs need from the owning session: the wire,
 * and the context-report push that the Context Management domain owns (a
 * knowledge edit changes the fixed context weight, so the session re-scans and
 * pushes the report after every mutation).
 */
export interface ProjectKnowledgeSessionHost {
  emit(msg: SessionOutboundMessage): void;
  pushContextReport(workspaceId: string): Promise<void>;
  /**
   * A Knowledge write is a working-tree write too. Wake the live Git status
   * and diff subscribers without coupling this domain to the checkout session.
   */
  notifyWorkspaceFilesChanged?(cwd: string): void;
  /**
   * Announce a project's changed metadata on the host-global project channel.
   * The store location is project metadata like the name and the Kanban target,
   * so every connected session must see it flip without a re-fetch.
   */
  announceProjectUpdate?(projectId: string): Promise<void>;
}

export interface ProjectKnowledgeSessionOptions {
  host: ProjectKnowledgeSessionHost;
  projectKnowledge: ProjectKnowledgeService | null | undefined;
  /** Resolves a project root to its store. Absent on hosts without the feature. */
  projectKnowledgeStores: ProjectKnowledgeStoreResolver | null | undefined;
  contextManagement: ContextManagementService;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: WorkspaceGitService;
  knowledgeRefinementGenerator: KnowledgeRefinementGenerator;
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
  private readonly projectKnowledgeStores: ProjectKnowledgeStoreResolver | null | undefined;
  private readonly contextManagement: ContextManagementService;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly knowledgeRefinementGenerator: KnowledgeRefinementGenerator;

  constructor(options: ProjectKnowledgeSessionOptions) {
    this.host = options.host;
    this.projectKnowledge = options.projectKnowledge;
    this.projectKnowledgeStores = options.projectKnowledgeStores;
    this.contextManagement = options.contextManagement;
    this.workspaceRegistry = options.workspaceRegistry;
    this.projectRegistry = options.projectRegistry;
    this.workspaceGitService = options.workspaceGitService;
    this.knowledgeRefinementGenerator = options.knowledgeRefinementGenerator;
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
      case "project.knowledge.refine.apply.request":
        return this.handleProjectKnowledgeRefineApplyRequest(msg);
      case "project.knowledge.refinement.propose.request":
        return this.handleProjectKnowledgeRefinementProposeRequest(msg);
      case "project.knowledge.delete.request":
        return this.handleProjectKnowledgeDeleteRequest(msg);
      case "project.knowledge.store.get.request":
        return this.handleProjectKnowledgeStoreGetRequest(msg);
      case "project.knowledge.store.set.request":
        return this.handleProjectKnowledgeStoreSetRequest(msg);
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
  /**
   * The store behind a workspace. Resolved from the registered project root
   * rather than the cwd, which keeps the catalog read off the Git snapshot path.
   */
  private async projectKnowledgeStore(workspaceId: string): Promise<ProjectKnowledgeStore | null> {
    if (!this.projectKnowledgeStores) return null;
    const root = await this.projectKnowledgeRoot(workspaceId);
    return root ? this.projectKnowledgeStores.resolveForRoot(root) : null;
  }
  private async handleProjectKnowledgeListRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.list.request" }>,
  ): Promise<void> {
    const store = await this.projectKnowledgeStore(msg.workspaceId);
    if (!this.projectKnowledge || !store) {
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
    const view = await this.projectKnowledge.catalogViewAtStore(store);
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
            ...(msg.tags !== undefined ? { tags: msg.tags } : {}),
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
  private async handleProjectKnowledgeRefineApplyRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.refine.apply.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    if (!this.projectKnowledge || !cwd)
      throw new Error("Project knowledge is unavailable for this workspace.");
    if (msg.target === "record") {
      const result =
        msg.id && msg.statement !== undefined
          ? await this.projectKnowledge.applyReviewedRefinement({
              cwd,
              id: msg.id,
              statement: msg.statement,
              ...(msg.evidence !== undefined ? { evidence: msg.evidence } : {}),
              ...(msg.expectedUpdatedAt ? { expectedUpdatedAt: msg.expectedUpdatedAt } : {}),
            })
          : { record: null, demoted: false, error: "A reviewed record requires its id and text." };
      if (result.record) {
        this.refreshReviewedRefinementConsumers(cwd, msg.workspaceId);
      }
      this.host.emit({
        type: "project.knowledge.refine.apply.response",
        payload: {
          requestId: msg.requestId,
          record: result.record,
          page: null,
          demoted: result.demoted,
          ...(result.error ? { error: result.error } : {}),
        },
      });
      return;
    }
    const result =
      msg.slug && msg.body !== undefined
        ? await this.projectKnowledge.applyRootRefinement({
            cwd,
            slug: msg.slug,
            body: msg.body,
            ...(msg.expectedBodyDigest ? { expectedBodyDigest: msg.expectedBodyDigest } : {}),
          })
        : { page: null, error: "A reviewed root page requires its slug and text." };
    if (result.page) {
      this.refreshReviewedRefinementConsumers(cwd, msg.workspaceId);
    }
    this.host.emit({
      type: "project.knowledge.refine.apply.response",
      payload: {
        requestId: msg.requestId,
        record: null,
        page: result.page,
        demoted: false,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }

  /**
   * The atomic write has already succeeded when this runs. Do not make the
   * review tab wait for Context Management's derived scan before it can return
   * to the changed document. The scan emits its own authoritative push when
   * it completes, while Git gets an immediate working-tree refresh.
   */
  private refreshReviewedRefinementConsumers(cwd: string, workspaceId: string): void {
    this.contextManagement.invalidate(workspaceId);
    this.host.notifyWorkspaceFilesChanged?.(cwd);
    void this.host.pushContextReport(workspaceId);
  }

  private async handleProjectKnowledgeRefinementProposeRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.refinement.propose.request" }>,
  ): Promise<void> {
    const cwd = await this.projectKnowledgeCwd(msg.workspaceId);
    const respond = (content: string | null, error?: string): void => {
      this.host.emit({
        type: "project.knowledge.refinement.propose.response",
        payload: { requestId: msg.requestId, content, ...(error ? { error } : {}) },
      });
    };
    if (!cwd || !this.projectKnowledge) {
      respond(null, "Project knowledge is unavailable for this workspace.");
      return;
    }
    try {
      respond(
        await this.knowledgeRefinementGenerator.propose({
          cwd,
          content: msg.content,
          directives: msg.directives,
        }),
      );
    } catch (error) {
      const message =
        error instanceof KnowledgeRefinementError || error instanceof Error
          ? error.message
          : "Failed to refine this Knowledge article.";
      respond(null, message);
    }
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

  private async handleProjectKnowledgeStoreGetRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.store.get.request" }>,
  ): Promise<void> {
    const emit = (store: ProjectKnowledgeStoreDescriptor | null, error: string | null): void => {
      this.host.emit({
        type: "project.knowledge.store.get.response",
        payload: { requestId: msg.requestId, store, error },
      });
    };
    const resolver = this.projectKnowledgeStores;
    if (!resolver) return emit(null, "This host does not support choosing a knowledge location.");
    try {
      const target = await this.resolveStoreSubject(msg);
      if (!target) return emit(null, "No project or workspace to resolve a knowledge store for.");
      emit(await this.describeStore(target.root, target.projectId), null);
    } catch (error) {
      emit(null, error instanceof Error ? error.message : "Failed to resolve knowledge location.");
    }
  }

  /**
   * The project root and id behind a store request. A `projectId` is answered
   * straight from the registry; a `workspaceId` goes through the workspace to
   * its project, falling back to Git root resolution for an unregistered one.
   */
  private async resolveStoreSubject(msg: {
    projectId?: string;
    workspaceId?: string;
  }): Promise<{ root: string; projectId: string | null } | null> {
    if (msg.projectId) {
      const project = await this.projectRegistry.get(msg.projectId);
      return project ? { root: project.rootPath, projectId: project.projectId } : null;
    }
    if (!msg.workspaceId) return null;
    const workspace = await this.workspaceRegistry.get(msg.workspaceId);
    if (!workspace) return null;
    const root = await this.projectKnowledgeRoot(msg.workspaceId);
    return root ? { root, projectId: workspace.projectId } : null;
  }

  private async handleProjectKnowledgeStoreSetRequest(
    msg: Extract<SessionInboundMessage, { type: "project.knowledge.store.set.request" }>,
  ): Promise<void> {
    const emit = (input: {
      accepted: boolean;
      store: ProjectKnowledgeStoreDescriptor | null;
      movedPageCount: number;
      error: string | null;
    }): void => {
      this.host.emit({
        type: "project.knowledge.store.set.response",
        payload: { requestId: msg.requestId, projectId: msg.projectId, ...input },
      });
    };
    const reject = (error: string): void =>
      emit({ accepted: false, store: null, movedPageCount: 0, error });

    const resolver = this.projectKnowledgeStores;
    if (!resolver) return reject("This host does not support choosing a knowledge location.");
    const project = await this.projectRegistry.get(msg.projectId);
    if (!project) return reject("Project not found.");

    try {
      // Resolve the current store before the override lands: once the record
      // says "host", the old repository store is no longer reachable through
      // normal resolution and there is nothing left to move from.
      const before = await resolver.resolveForRoot(project.rootPath);
      await this.projectRegistry.update(msg.projectId, (record) => ({
        ...record,
        knowledgeLocation: msg.location,
        updatedAt: new Date().toISOString(),
      }));
      const after = await resolver.resolveForRoot(project.rootPath);

      const movedPageCount = msg.movePages
        ? await resolver.movePages({ from: before, to: after })
        : await this.prepareWithoutMoving(after);

      // The catalog's fixed context weight is measured from the store, so a
      // switch changes it even though no page's content did.
      if (msg.workspaceId) {
        this.contextManagement.invalidate(msg.workspaceId);
        await this.host.pushContextReport(msg.workspaceId);
      }
      await this.host.announceProjectUpdate?.(msg.projectId);
      emit({
        accepted: true,
        store: await this.describeStore(project.rootPath, msg.projectId),
        movedPageCount,
        error: null,
      });
    } catch (error) {
      reject(error instanceof Error ? error.message : "Failed to set the knowledge location.");
    }
  }

  /**
   * The user declined to carry the pages across. The new store still needs to
   * exist and be identifiable, or a later switch back cannot tell whose it was.
   */
  private async prepareWithoutMoving(store: ProjectKnowledgeStore): Promise<number> {
    if (store.location === "host") await this.projectKnowledgeStores?.ensureHostStoreMarker(store);
    return 0;
  }

  private async describeStore(
    root: string,
    projectId: string | null,
  ): Promise<ProjectKnowledgeStoreDescriptor | null> {
    const resolver = this.projectKnowledgeStores;
    if (!resolver) return null;
    const project = projectId ? await this.projectRegistry.get(projectId) : null;
    const store = await resolver.resolveForRoot(root);
    const other = await resolver.storeAtLocation(
      root,
      store.location === "repository" ? "host" : "repository",
    );
    return {
      location: store.location,
      override: (project?.knowledgeLocation ?? null) as ProjectKnowledgeStoreLocation | null,
      hostDefault: resolver.hostDefaultLocation(),
      basePath: store.base,
      projectId: project?.projectId ?? null,
      hasPages: await storeHasPages(store),
      otherLocationHasPages: await storeHasPages(other),
    };
  }
}
