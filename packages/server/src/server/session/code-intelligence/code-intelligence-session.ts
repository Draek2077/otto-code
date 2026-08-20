import { resolve as resolvePath } from "node:path";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import type {
  CodeListFilesRequest,
  CodeOutlineRequest,
  CodeSymbolsRequest,
  CodeDefinitionRequest,
  CodeDefinitionResponse,
  CodeDocumentSyncRequest,
  CodeDocumentCloseRequest,
  CodeHoverRequest,
  CodeReferencesRequest,
  CodeRenameApplyRequest,
  CodeRenameUndoRequest,
  CodeRenamePreviewRequest,
  CodeSolutionListRequest,
  CodeSolutionGetTreeRequest,
  CodeSolutionLoadProjectRequest,
  SolutionRef,
  LspServersListRequest,
  LspServerStopRequest,
} from "../../messages.js";
import { getFileOutline, listWorkspaceFiles } from "../../file-explorer/code-index.js";
import { isSameOrDescendantPath } from "../../path-utils.js";

import type pino from "pino";
import type { LspService } from "../../lsp/service.js";
import type { SolutionService } from "../../solution-model/service.js";
import type { WorkspaceSymbolIndex } from "../../file-explorer/code-index.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

/** The wire is all the code-intelligence RPCs need from the owning session. */
export interface CodeIntelligenceSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface CodeIntelligenceSessionOptions {
  host: CodeIntelligenceSessionHost;
  lspService: LspService;
  /**
   * Daemon-scoped like `lspService`, and separate from it on purpose: the Solution view is not an
   * LSP feature, because LSP has no project-structure request to build one on.
   */
  solutionService: SolutionService;
  /**
   * The files session's ctags index - shared, not owned: file writes over there
   * invalidate it, code.symbols/code.outline over here read it.
   */
  symbolIndex: WorkspaceSymbolIndex;
  /** The files session's workspace-boundary guard, so both domains refuse identically. */
  assertCwdWithinKnownWorkspace: (cwd: string) => Promise<void>;
  logger: pino.Logger;
}

/**
 * The code-intelligence session domain: the ctags index RPCs (code.symbols,
 * code.outline, code.list_files), the language-server family (definition,
 * hover, references, rename, document sync, lsp.servers) and the Solution
 * view. Extracted from the files session so the file-I/O module keeps its
 * stated single concern, matching the shape session/brain/, communications/,
 * runs/ and project-knowledge/ follow.
 */
export class CodeIntelligenceSession {
  private readonly host: CodeIntelligenceSessionHost;
  private readonly lspService: LspService;
  private readonly solutionService: SolutionService;
  private readonly symbolIndex: WorkspaceSymbolIndex;
  private readonly assertCwdWithinKnownWorkspace: (cwd: string) => Promise<void>;
  private readonly logger: pino.Logger;

  constructor(options: CodeIntelligenceSessionOptions) {
    this.host = options.host;
    this.lspService = options.lspService;
    this.solutionService = options.solutionService;
    this.symbolIndex = options.symbolIndex;
    this.assertCwdWithinKnownWorkspace = options.assertCwdWithinKnownWorkspace;
    this.logger = options.logger.child({ module: "code-intelligence-session" });
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "code.list_files.request":
        return this.handleCodeListFilesRequest(msg);
      case "code.symbols.request":
        return this.handleCodeSymbolsRequest(msg);
      case "code.definition.request":
        return this.handleCodeDefinitionRequest(msg);
      case "code.document.sync.request":
        return this.handleCodeDocumentSyncRequest(msg);
      case "code.document.close.request":
        return this.handleCodeDocumentCloseRequest(msg);
      case "code.hover.request":
        return this.handleCodeHoverRequest(msg);
      case "code.references.request":
        return this.handleCodeReferencesRequest(msg);
      case "code.rename.preview.request":
        return this.handleCodeRenamePreviewRequest(msg);
      case "code.rename.apply.request":
        return this.handleCodeRenameApplyRequest(msg);
      case "code.rename.undo.request":
        return this.handleCodeRenameUndoRequest(msg);
      case "lsp.servers.list.request":
        return this.handleLspServersListRequest(msg);
      case "lsp.server.stop.request":
        return this.handleLspServerStopRequest(msg);
      case "code.outline.request":
        return this.handleCodeOutlineRequest(msg);
      // The Solution view. Under `code.` and dispatched here, but independent of everything
      // above it: LSP has no project-structure request, so this reads solutions through its own
      // subsystem and is unaffected by the C# row's on/off state.
      case "code.solution.list.request":
        return this.handleCodeSolutionListRequest(msg);
      case "code.solution.get_tree.request":
        return this.handleCodeSolutionGetTreeRequest(msg);
      case "code.solution.load_project.request":
        return this.handleCodeSolutionLoadProjectRequest(msg);
      default:
        return undefined;
    }
  }

  async handleCodeListFilesRequest(request: CodeListFilesRequest): Promise<void> {
    const cwd = request.cwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "code.list_files.response",
        payload: {
          cwd: request.cwd,
          files: [],
          truncated: false,
          error: "cwd is required",
          requestId: request.requestId,
        },
      });
      return;
    }
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const { files, truncated } = await listWorkspaceFiles(cwd);
      this.host.emit({
        type: "code.list_files.response",
        payload: { cwd, files, truncated, error: null, requestId: request.requestId },
      });
    } catch (error) {
      this.logger.error({ err: error, cwd }, `Failed to list files for workspace ${cwd}`);
      this.host.emit({
        type: "code.list_files.response",
        payload: {
          cwd,
          files: [],
          truncated: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * The LSP-backed sibling of `handleCodeSymbolsRequest`. Same workspace guard, but it
   * resolves the reference at a position instead of matching a name, and its
   * three-valued status distinguishes "no server on this host" and "still indexing"
   * from "looked and found nothing".
   */
  async handleCodeDefinitionRequest(request: CodeDefinitionRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const respond = (
      status: "ok" | "indexing" | "unavailable",
      locations: CodeDefinitionResponse["payload"]["locations"],
      error: string | null,
    ): void => {
      this.host.emit({
        type: "code.definition.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          status,
          locations,
          error,
          requestId: request.requestId,
        },
      });
    };

    if (!cwd) {
      respond("unavailable", [], "cwd is required");
      return;
    }

    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const filePath = this.resolveWorkspacePath(cwd, request.path);
      const result = await this.lspService.definition({
        rootPath: cwd,
        filePath,
        line: request.line,
        column: request.column,
      });
      respond(result.status, result.locations, result.error);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path },
        `Failed to resolve definition for ${request.path}`,
      );
      respond("unavailable", [], getErrorMessage(error));
    }
  }

  async handleCodeDocumentSyncRequest(request: CodeDocumentSyncRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      await this.lspService.syncDocument({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
        text: request.text,
      });
      this.host.emit({
        type: "code.document.sync.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          ok: true,
          error: null,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.document.sync.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          ok: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleCodeHoverRequest(request: CodeHoverRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const result = await this.lspService.hover({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
        line: request.line,
        column: request.column,
      });
      this.host.emit({
        type: "code.hover.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          status: result.status,
          markdown: result.markdown,
          range: result.range,
          serverId: result.serverId,
          error: result.error,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.hover.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          status: "unavailable",
          markdown: null,
          range: null,
          serverId: null,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleCodeReferencesRequest(request: CodeReferencesRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const result = await this.lspService.references({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
        line: request.line,
        column: request.column,
      });
      this.host.emit({
        type: "code.references.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          status: result.status,
          locations: result.locations,
          error: result.error,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.references.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          status: "unavailable",
          locations: [],
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /** Computes the plan only. Nothing is written here - applying is a separate, explicit act. */
  async handleCodeRenamePreviewRequest(request: CodeRenamePreviewRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const plan = await this.lspService.renamePreview({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
        line: request.line,
        column: request.column,
        newName: request.newName,
      });
      this.host.emit({
        type: "code.rename.preview.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          newName: request.newName,
          status: plan.status,
          files: plan.files,
          fileCount: plan.fileCount,
          editCount: plan.editCount,
          planId: plan.planId,
          error: plan.error,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.rename.preview.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          newName: request.newName,
          status: "unavailable",
          files: [],
          fileCount: 0,
          editCount: 0,
          planId: "",
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * The one request in this subsystem that writes. It carries no edits - only the `planId`
   * of the plan the user audited - so the daemon's own language server stays the sole
   * author of what lands on disk. See `LspService.renameApply` for the four gates.
   */
  async handleCodeRenameApplyRequest(request: CodeRenameApplyRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const applied = await this.lspService.renameApply({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
        line: request.line,
        column: request.column,
        newName: request.newName,
        planId: request.planId,
      });
      this.host.emit({
        type: "code.rename.apply.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          newName: request.newName,
          status: applied.status,
          runId: applied.runId,
          files: applied.files,
          appliedFiles: applied.appliedFiles,
          appliedEdits: applied.appliedEdits,
          skippedEdits: applied.skippedEdits,
          complete: applied.complete,
          error: applied.error,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.rename.apply.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          newName: request.newName,
          status: "expired",
          runId: null,
          files: [],
          appliedFiles: 0,
          appliedEdits: 0,
          skippedEdits: 0,
          complete: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * Take a run back. Carries only the run id - the daemon holds the before-images, so an
   * undo can no more be forged into an arbitrary write than an apply can.
   */
  async handleCodeRenameUndoRequest(request: CodeRenameUndoRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const undone = await this.lspService.renameUndo(request.runId);
      this.host.emit({
        type: "code.rename.undo.response",
        payload: {
          cwd: request.cwd,
          runId: request.runId,
          status: undone.status,
          files: undone.files,
          restoredFiles: undone.restoredFiles,
          complete: undone.complete,
          error: undone.error,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.rename.undo.response",
        payload: {
          cwd: request.cwd,
          runId: request.runId,
          status: "expired",
          files: [],
          restoredFiles: 0,
          complete: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleLspServersListRequest(request: LspServersListRequest): Promise<void> {
    // No cwd is the host-wide question the settings screen asks: what can this machine
    // run, and what is up right now. There is no path to authorize in that case, since the
    // workspace check guards reading a directory and host-wide discovery reads none.
    const cwd = request.cwd?.trim() ?? "";
    const scope = cwd.length > 0 ? cwd : null;
    try {
      if (scope !== null) {
        await this.assertCwdWithinKnownWorkspace(scope);
      }
      const [languages, running] = await Promise.all([
        this.lspService.languageStates(scope),
        Promise.resolve(this.lspService.running()),
      ]);
      this.host.emit({
        type: "lsp.servers.list.response",
        payload: {
          cwd,
          languages,
          running: running.map((entry) => ({
            rootPath: entry.rootPath,
            serverId: entry.serverId,
            uptimeMs: entry.uptimeMs,
            lastUsedAt: entry.lastUsedAt,
          })),
          error: null,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "lsp.servers.list.response",
        payload: {
          cwd,
          languages: [],
          running: [],
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleLspServerStopRequest(request: LspServerStopRequest): Promise<void> {
    try {
      await this.assertCwdWithinKnownWorkspace(request.rootPath.trim());
      await this.lspService.stopServer(request.rootPath, request.serverId);
      this.host.emit({
        type: "lsp.server.stop.response",
        payload: {
          rootPath: request.rootPath,
          serverId: request.serverId,
          ok: true,
          error: null,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "lsp.server.stop.response",
        payload: {
          rootPath: request.rootPath,
          serverId: request.serverId,
          ok: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * The Solution view's discovery request, and the reason the whole feature can be transparent.
   *
   * It never throws and never reports an error the client has to render: a workspace with no
   * solution, a host with no .NET SDK, and a disabled feature all come back as an empty list,
   * which the client reads as "no switcher". Four states collapsed into one silent case, because
   * a user who has never opened a .NET project should not learn that this subsystem exists.
   */
  async handleCodeSolutionListRequest(request: CodeSolutionListRequest): Promise<void> {
    const cwd = request.cwd.trim();
    let solutions: SolutionRef[] = [];
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      solutions = await this.solutionService.listSolutions(cwd);
    } catch (error) {
      this.logger.debug({ err: error, cwd }, "solution discovery unavailable");
    }
    this.host.emit({
      type: "code.solution.list.response",
      payload: { cwd: request.cwd, solutions, error: null, requestId: request.requestId },
    });
  }

  async handleCodeSolutionGetTreeRequest(request: CodeSolutionGetTreeRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const tree = await this.solutionService.getTree({
        root: cwd,
        solutionPath: request.solutionPath,
      });
      this.host.emit({
        type: "code.solution.get_tree.response",
        payload: { cwd: request.cwd, ...tree, error: null, requestId: request.requestId },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, solutionPath: request.solutionPath },
        `Failed to read solution ${request.solutionPath}`,
      );
      this.host.emit({
        type: "code.solution.get_tree.response",
        payload: {
          cwd: request.cwd,
          solutionPath: request.solutionPath,
          name: "",
          format: "sln",
          folders: [],
          projects: [],
          buildTypes: [],
          platforms: [],
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * One project's evaluated membership.
   *
   * Note the deliberate asymmetry with every other file RPC here: the project path is **not**
   * re-contained inside the workspace. A solution may name a project outside the root, and the
   * settled policy is to stay out of the way - the solution file itself is the authority naming
   * that path, so this is following a declaration rather than free-browsing the disk. The `cwd`
   * guard above still applies, so a client cannot use this to read an arbitrary directory: it can
   * only reach what a solution Otto already knows about points at.
   */
  async handleCodeSolutionLoadProjectRequest(
    request: CodeSolutionLoadProjectRequest,
  ): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const project = await this.solutionService.loadProject({
        root: cwd,
        solutionPath: request.solutionPath,
        projectPath: request.projectPath,
      });
      this.host.emit({
        type: "code.solution.load_project.response",
        payload: {
          cwd: request.cwd,
          solutionPath: request.solutionPath,
          ...project,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, projectPath: request.projectPath },
        `Failed to evaluate project ${request.projectPath}`,
      );
      this.host.emit({
        type: "code.solution.load_project.response",
        payload: {
          cwd: request.cwd,
          solutionPath: request.solutionPath,
          projectPath: request.projectPath,
          // `unavailable`, not `failed`: the host could not answer at all, which is a different
          // thing from MSBuild reading the project and refusing it.
          status: "unavailable",
          nodes: [],
          projectReferences: [],
          packageReferences: [],
          targetFrameworks: [],
          outputType: null,
          isSdkStyle: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleCodeDocumentCloseRequest(request: CodeDocumentCloseRequest): Promise<void> {
    const cwd = request.cwd.trim();
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      await this.lspService.closeDocument({
        rootPath: cwd,
        filePath: this.resolveWorkspacePath(cwd, request.path),
      });
      this.host.emit({
        type: "code.document.close.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          ok: true,
          error: null,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "code.document.close.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          ok: false,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleCodeSymbolsRequest(request: CodeSymbolsRequest): Promise<void> {
    const cwd = request.cwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "code.symbols.response",
        payload: {
          cwd: request.cwd,
          name: request.name,
          locations: [],
          error: "cwd is required",
          requestId: request.requestId,
        },
      });
      return;
    }
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const locations = await this.symbolIndex.findSymbol(cwd, request.name);
      this.host.emit({
        type: "code.symbols.response",
        payload: { cwd, name: request.name, locations, error: null, requestId: request.requestId },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, name: request.name },
        `Failed to resolve symbol for workspace ${cwd}`,
      );
      this.host.emit({
        type: "code.symbols.response",
        payload: {
          cwd,
          name: request.name,
          locations: [],
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleCodeOutlineRequest(request: CodeOutlineRequest): Promise<void> {
    const cwd = request.cwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "code.outline.response",
        payload: {
          cwd: request.cwd,
          path: request.path,
          symbols: [],
          error: "cwd is required",
          requestId: request.requestId,
        },
      });
      return;
    }
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const symbols = await getFileOutline(cwd, request.path);
      this.host.emit({
        type: "code.outline.response",
        payload: { cwd, path: request.path, symbols, error: null, requestId: request.requestId },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path },
        `Failed to build outline for workspace ${cwd}`,
      );
      this.host.emit({
        type: "code.outline.response",
        payload: {
          cwd,
          path: request.path,
          symbols: [],
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * Absolute path for a workspace-relative request path. The LSP handlers need an
   * absolute path (a `file://` URI is built from it), so containment is re-checked here
   * rather than trusted from the relative form.
   */
  private resolveWorkspacePath(cwd: string, relativePath: string): string {
    const resolved = resolvePath(cwd, relativePath);
    if (!isSameOrDescendantPath(cwd, resolved)) {
      throw new Error(`Path is outside the workspace: ${relativePath}`);
    }
    return resolved;
  }
}
