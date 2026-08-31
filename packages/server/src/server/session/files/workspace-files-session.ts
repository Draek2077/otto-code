import { dirname, join, resolve as resolvePath } from "node:path";
import type pino from "pino";
import type { SolutionService } from "../../solution-model/service.js";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@otto-code/protocol/binary-frames/index";
import type {
  FileCreateRequest,
  FileCreateResult,
  FileDeleteRequest,
  FileDeleteResult,
  FileDownloadTokenRequest,
  FileEntryCreateRequest,
  FileEntryDeleteRequest,
  FileEntryDuplicateRequest,
  FileEntryRenameRequest,
  FileExplorerRequest,
  FileRenameRequest,
  FileRenameResult,
  FileReplaceRequest,
  FileSearchRequest,
  FileSearchSummary,
  FileUploadRequest,
  FileWatchSubscribeRequest,
  FileWatchUnsubscribeRequest,
  FileWriteRequest,
  FileWriteResult,
  FsFileWriteBinaryRequest,
  FsFileWriteBinaryResult,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerBinaryFile,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import { WorkspaceBinaryWriteStore } from "../../file-explorer/binary-write-store.js";
import { SessionFileWatcher } from "../../file-explorer/file-watcher.js";
import { replaceInWorkspaceFiles, searchWorkspaceFiles } from "../../file-explorer/file-search.js";
import { WorkspaceSymbolIndex } from "../../file-explorer/code-index.js";
import { getProjectIcon } from "../../../utils/project-icon.js";
import { expandUserPath, isSameOrDescendantPath } from "../../path-utils.js";
const ACCESS_OUTSIDE_WORKSPACES_MESSAGE = "Access outside of known workspaces is not allowed";

/**
 * Thrown when a **directory-scoped** file RPC targets a `cwd` that is not one
 * of Otto's known workspace roots (nor a descendant of one). Carries the same
 * message the handlers surface to the client so directory browsing, search,
 * and indexing stay bounded to paths Otto actually knows about. Single-file
 * read/write/watch do not throw this - they are exempt by design.
 */
class WorkspaceAccessError extends Error {
  constructor() {
    super(ACCESS_OUTSIDE_WORKSPACES_MESSAGE);
    this.name = "WorkspaceAccessError";
  }
}

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * - old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  // `source` is the socket that issued the request. Otto routes file-transfer
  // responses back to it rather than fanning out to every session.
  emit(msg: SessionOutboundMessage, source?: object): void;
  // Awaitable: the source-scoped send applies backpressure and rejects once the
  // requesting socket detaches. Firing chunks without awaiting queued a whole
  // multi-megabyte file at once and turned that rejection into an unhandled one.
  emitBinary(frame: Uint8Array, source?: object): void | Promise<void>;
  hasBinaryChannel(): boolean;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  /**
   * Only for the watcher's cache-invalidation ping in the constructor; the
   * Solution RPCs live in the CodeIntelligenceSession, which holds its own
   * reference to the same daemon-scoped service.
   */
  solutionService: SolutionService;
  ottoHome: string;
  logger: pino.Logger;
  /**
   * Resolves the distinct absolute filesystem roots the client is allowed to
   * reach through the **directory-scoped** file RPCs - every known Otto
   * workspace (and project) path. Evaluated per request so workspaces created
   * or removed mid-session are reflected immediately. A requested `cwd` is
   * honored only when it equals or sits inside one of these roots; anything
   * else is refused. This bounds directory listing, project search/replace,
   * code indexing, project icons, and download tokens to workspaces Otto knows
   * about. Single-file read/write/watch are deliberately exempt (preview/edit
   * any file, gated on the client and by OS permissions) - see the call sites.
   * Path-containment within the `cwd` is still enforced separately by the
   * file-explorer service.
   */
  resolveAllowedRoots: () => Promise<string[]>;
  /** Test hook: tighten the watcher's timing so specs stay fast. */
  watchOptions?: { pollIntervalMs?: number; debounceMs?: number };
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state - file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly solutionService: SolutionService;
  private readonly logger: pino.Logger;
  private readonly resolveAllowedRoots: () => Promise<string[]>;
  private readonly fileUploads: FileUploadStore;
  private readonly binaryWrites = new WorkspaceBinaryWriteStore();
  private readonly fileWatcher: SessionFileWatcher;
  // Readable by the CodeIntelligenceSession, which shares this index: writes here
  // invalidate, code.symbols/code.outline over there read.
  readonly symbolIndex = new WorkspaceSymbolIndex();
  private activeSearchSignal: { superseded: boolean } | null = null;

  constructor(options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.solutionService = options.solutionService;
    this.logger = options.logger;
    this.resolveAllowedRoots = options.resolveAllowedRoots;
    this.fileUploads = new FileUploadStore({ ottoHome: options.ottoHome });
    this.fileWatcher = new SessionFileWatcher({
      logger: options.logger,
      emitEvent: (event) => {
        this.host.emit({ type: "file.watch.event", payload: event });
        // Bonus signal, not the correctness mechanism. This watcher only sees files a client has
        // open in a tab, and a `Directory.Build.props` rarely does - the solution cache's own
        // read-side freshness check is what keeps the tree honest. When a tab *is* open on one,
        // this drops the affected evaluations immediately instead of at the next read.
        this.solutionService.invalidatePath(resolvePath(event.cwd, event.path));
      },
      ...options.watchOptions,
    });
  }

  dispose(): void {
    this.fileWatcher.dispose();
  }

  /**
   * Boundary gate for every file RPC: the requested `cwd` must be one of Otto's
   * known workspace roots or a descendant of one. This is what lets a client
   * open files from any workspace - not just the active one - while keeping the
   * daemon from serving arbitrary paths outside every workspace it knows about.
   * WSL/Windows path forms are folded together by `isSameOrDescendantPath`.
   */
  // Public so the CodeIntelligenceSession can share the exact same boundary check.
  async assertCwdWithinKnownWorkspace(cwd: string): Promise<void> {
    const expandedCwd = expandUserPath(cwd);
    const roots = await this.resolveAllowedRoots();
    const allowed = roots.some((root) => isSameOrDescendantPath(expandUserPath(root), expandedCwd));
    if (!allowed) {
      throw new WorkspaceAccessError();
    }
  }

  async handleFileWatchSubscribeRequest(request: FileWatchSubscribeRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const respond = (ok: boolean, error: string | null): void => {
      this.host.emit({
        type: "file.watch.subscribe.response",
        payload: {
          cwd: cwd || request.cwd,
          path: request.path,
          ok,
          error,
          requestId: request.requestId,
        },
      });
    };
    if (!cwd) {
      respond(false, "cwd is required");
      return;
    }
    try {
      // Single-file watch is unbounded: a tab may preview/edit a file outside
      // every known workspace, and its watch must follow. OS filesystem
      // permissions are the boundary here - the directory-scoped RPCs below
      // stay workspace-bounded via assertCwdWithinKnownWorkspace.
      await this.fileWatcher.subscribe({ cwd, path: request.path });
      respond(true, null);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path },
        `Failed to subscribe file watch for workspace ${cwd}`,
      );
      respond(false, getErrorMessage(error));
    }
  }

  handleFileWatchUnsubscribeRequest(request: FileWatchUnsubscribeRequest): void {
    const cwd = request.cwd.trim();
    if (cwd) {
      this.fileWatcher.unsubscribe({ cwd, path: request.path });
    }
    this.host.emit({
      type: "file.watch.unsubscribe.response",
      payload: {
        cwd: cwd || request.cwd,
        path: request.path,
        ok: Boolean(cwd),
        error: cwd ? null : "cwd is required",
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryCreateRequest(request: FileEntryCreateRequest): Promise<void> {
    const result = await createExplorerEntry({
      root: request.cwd,
      relativePath: join(request.parentPath, request.name),
      kind: request.kind,
    });
    this.host.emit({
      type: "fs.entry.create.response",
      payload: {
        cwd: request.cwd,
        parentPath: request.parentPath,
        path: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : `"${request.name.trim()}" already exists`,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryRenameRequest(request: FileEntryRenameRequest): Promise<void> {
    const result = await renameExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
      newRelativePath: join(dirname(request.path), request.name),
    });
    let error: string | null = null;
    if (result.status === "not_found") {
      error = "File or folder no longer exists";
    } else if (result.status !== "ok") {
      error = `"${request.name.trim()}" already exists`;
    }
    this.host.emit({
      type: "fs.entry.rename.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        renamedPath: result.status === "ok" ? result.to : null,
        success: result.status === "ok",
        error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDuplicateRequest(request: FileEntryDuplicateRequest): Promise<void> {
    const result = await duplicateExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
    });
    this.host.emit({
      type: "fs.entry.duplicate.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        duplicatedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDeleteRequest(request: FileEntryDeleteRequest): Promise<void> {
    const result = await deleteExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
      recursive: true,
    });
    let error: string | null = null;
    if (result.status === "not_found") {
      error = "File or folder no longer exists";
    } else if (result.status !== "ok") {
      error = "Folder is not empty";
    }
    this.host.emit({
      type: "fs.entry.delete.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        success: result.status === "ok",
        error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file_explorer_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          mode,
          directory: null,
          file: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      if (mode === "list") {
        // Directory browsing stays workspace-bounded - there is no
        // "browse any folder" surface. Single-file reads (the `else` branch)
        // are unbounded so any file can be previewed; OS permissions gate them.
        await this.assertCwdWithinKnownWorkspace(cwd);
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.host.emit({
          type: "file_explorer_response",
          payload: {
            cwd,
            path: directory.path,
            mode,
            directory,
            file: null,
            error: null,
            requestId,
          },
        });
      } else {
        if (request.maxBytes) {
          const file = await getDownloadableFileInfo({ root: cwd, relativePath: requestedPath });
          if (file.size > request.maxBytes) {
            throw new Error("File is too large to display");
          }
        }
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          // Streamed rather than buffered: a large file used to be read whole
          // into memory before its first byte reached the client, which is what
          // made large file views drop their connection. The chunk loop also
          // re-checks the file's revision at the end, so a file rewritten
          // mid-transfer raises instead of arriving as two spliced revisions.
          await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileBegin,
                requestId,
                metadata: {
                  mime: file.mimeType,
                  size: file.size,
                  encoding: file.encoding,
                  modifiedAt: file.modifiedAt,
                  revision: file.revision,
                },
              }),
              source,
            );
            for await (const chunk of file.chunks) {
              await this.host.emitBinary(
                encodeFileTransferFrame({
                  opcode: FileTransferOpcode.FileChunk,
                  requestId,
                  payload: chunk,
                }),
                source,
              );
            }
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileEnd,
                requestId,
              }),
              source,
            );
          });
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emit({
            type: "file_explorer_response",
            payload: {
              cwd,
              path: file.path,
              mode,
              directory: null,
              file,
              error: null,
              requestId,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file_explorer_response",
        payload: {
          cwd,
          path: requestedPath,
          mode,
          directory: null,
          file: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileWriteRequest(request: FileWriteRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    const emitResult = (result: FileWriteResult): void => {
      this.host.emit({
        type: "file.write.response",
        payload: {
          cwd: cwd || workspaceCwd,
          path: requestedPath,
          result,
          requestId,
        },
      });
    };

    if (!cwd) {
      emitResult({ status: "error", message: "cwd is required" });
      return;
    }

    try {
      // Writes are unbounded at the daemon: editing a file outside every known
      // workspace is allowed, gated on the client by an "edit anyway" warning
      // and bounded here only by OS filesystem permissions (a write the daemon's
      // user cannot perform fails with the OS error, which is the intended
      // outcome). Path containment within `cwd` is still enforced by
      // writeExplorerFile.
      const outcome = await writeExplorerFile({
        root: cwd,
        relativePath: requestedPath,
        content: request.content,
        expectedModifiedAt: request.expectedModifiedAt,
        expectedHash: request.expectedHash,
        allowCreate: request.allowCreate,
        eol: request.eol,
      });
      if (outcome.status === "ok") {
        // The file's symbols may have changed; the next lookup rebuilds.
        this.symbolIndex.invalidate(cwd);
      }
      emitResult(outcome);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file write request for workspace ${cwd}`,
      );
      emitResult({ status: "error", message: getErrorMessage(error) });
    }
  }

  /**
   * The binary sibling of `file.write`. Workspace-bounded, unlike that one -
   * see `FsFileWriteBinaryRequestSchema` for the reasoning.
   *
   * The bytes normally follow as file-transfer frames, so this is the metadata
   * half and the response comes at FileEnd rather than from here.
   */
  handleFsFileWriteBinaryRequest(request: FsFileWriteBinaryRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const emitResult = (result: FsFileWriteBinaryResult): void => {
      this.host.emit({
        type: "fs.file.write_binary.response",
        payload: {
          cwd: cwd || request.cwd,
          path: request.path,
          result,
          requestId: request.requestId,
        },
      });
    };

    if (!cwd) {
      emitResult({ status: "error", error: "cwd is required" });
      return Promise.resolve();
    }

    // COMPAT(binaryWriteBase64): added in v0.7.6, drop this branch on
    // 2027-02-02. A client that has not moved to frames still sends the payload
    // inline, and the whole of it is here when the handler runs.
    if (request.contentBase64 !== undefined) {
      return this.writeBinaryBytes({
        cwd,
        path: request.path,
        bytes: Buffer.from(request.contentBase64, "base64"),
        overwrite: request.overwrite,
        emitResult,
      });
    }

    if (request.size === undefined) {
      emitResult({ status: "error", error: "size is required when no content is inlined" });
      return Promise.resolve();
    }

    // Registration is synchronous, and the boundary check rides along as a
    // promise rather than being awaited: the frames are already behind this
    // message in the socket, and a transfer the store has not heard of yet is
    // one `handleFileTransferFrame` hands to the upload store instead. The
    // store settles the guard before it writes.
    const guard = this.assertCwdWithinKnownWorkspace(cwd);
    guard.catch(() => undefined);
    this.binaryWrites.begin({
      requestId: request.requestId,
      cwd,
      path: request.path,
      size: request.size,
      overwrite: request.overwrite,
      guard,
    });
    return Promise.resolve();
  }

  private async writeBinaryBytes(input: {
    cwd: string;
    path: string;
    bytes: Buffer;
    overwrite?: boolean;
    emitResult: (result: FsFileWriteBinaryResult) => void;
  }): Promise<void> {
    try {
      await this.assertCwdWithinKnownWorkspace(input.cwd);
      const outcome = await writeExplorerBinaryFile({
        root: input.cwd,
        relativePath: input.path,
        bytes: input.bytes,
        overwrite: input.overwrite,
      });
      this.noteBinaryWrite(input.cwd, outcome);
      input.emitResult(outcome);
    } catch (error) {
      this.logger.error(
        { err: error, cwd: input.cwd, path: input.path },
        `Failed to write binary file ${input.path} in workspace ${input.cwd}`,
      );
      input.emitResult({ status: "error", error: getErrorMessage(error) });
    }
  }

  private noteBinaryWrite(cwd: string, result: FsFileWriteBinaryResult): void {
    if (result.status === "written") {
      // A generated artifact carries no symbols, but the tree it landed in
      // may be indexed and now has one more entry.
      this.symbolIndex.invalidate(cwd);
    }
  }

  /**
   * Create, delete and rename share one shape, and one policy that separates
   * them from `file.write`: they are **workspace-bounded**. `file.write` is
   * deliberately not - a tab may edit a file outside every known workspace -
   * but the mutation surface is reached from the explorer tree, which is itself
   * workspace-bounded, and "unlink any path on the host" is not a capability
   * worth having for the sake of symmetry. Containment inside `cwd` is enforced
   * a second time by the file-explorer service, which never follows the final
   * path component.
   */
  async handleFileCreateRequest(request: FileCreateRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const emitResult = (result: FileCreateResult): void => {
      this.host.emit({
        type: "file.create.response",
        payload: {
          cwd: cwd || request.cwd,
          path: request.path,
          result,
          requestId: request.requestId,
        },
      });
    };

    if (!cwd) {
      emitResult({ status: "error", message: "cwd is required" });
      return;
    }

    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const outcome = await createExplorerEntry({
        root: cwd,
        relativePath: request.path,
        kind: request.kind,
      });
      if (outcome.status === "ok") {
        this.symbolIndex.invalidate(cwd);
      }
      emitResult(outcome);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path },
        `Failed to create ${request.path} in workspace ${cwd}`,
      );
      emitResult({ status: "error", message: getErrorMessage(error) });
    }
  }

  async handleFileDeleteRequest(request: FileDeleteRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const emitResult = (result: FileDeleteResult): void => {
      this.host.emit({
        type: "file.delete.response",
        payload: {
          cwd: cwd || request.cwd,
          path: request.path,
          result,
          requestId: request.requestId,
        },
      });
    };

    if (!cwd) {
      emitResult({ status: "error", message: "cwd is required" });
      return;
    }

    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const outcome = await deleteExplorerEntry({
        root: cwd,
        relativePath: request.path,
        recursive: request.recursive,
      });
      if (outcome.status === "ok") {
        this.symbolIndex.invalidate(cwd);
      }
      emitResult(outcome);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path },
        `Failed to delete ${request.path} in workspace ${cwd}`,
      );
      emitResult({ status: "error", message: getErrorMessage(error) });
    }
  }

  async handleFileRenameRequest(request: FileRenameRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const emitResult = (result: FileRenameResult): void => {
      this.host.emit({
        type: "file.rename.response",
        payload: {
          cwd: cwd || request.cwd,
          path: request.path,
          newPath: request.newPath,
          result,
          requestId: request.requestId,
        },
      });
    };

    if (!cwd) {
      emitResult({ status: "error", message: "cwd is required" });
      return;
    }

    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const outcome = await renameExplorerEntry({
        root: cwd,
        relativePath: request.path,
        newRelativePath: request.newPath,
      });
      if (outcome.status === "ok") {
        this.symbolIndex.invalidate(cwd);
      }
      emitResult(outcome);
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: request.path, newPath: request.newPath },
        `Failed to rename ${request.path} in workspace ${cwd}`,
      );
      emitResult({ status: "error", message: getErrorMessage(error) });
    }
  }

  async handleFileSearchRequest(request: FileSearchRequest): Promise<void> {
    const cwd = request.cwd.trim();
    const respond = (summary: Omit<FileSearchSummary, "cwd" | "requestId">): void => {
      this.host.emit({
        type: "file.search.response",
        payload: { cwd: cwd || request.cwd, requestId: request.requestId, ...summary },
      });
    };
    if (!cwd) {
      respond({ status: "error", error: "cwd is required", fileCount: 0, matchCount: 0 });
      return;
    }
    // One search at a time per session: a new query supersedes the previous
    // scan mid-flight (the UI issues explicit, press-enter searches).
    if (this.activeSearchSignal) {
      this.activeSearchSignal.superseded = true;
    }
    const signal = { superseded: false };
    this.activeSearchSignal = signal;
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const outcome = await searchWorkspaceFiles({
        root: cwd,
        query: request.query,
        caseSensitive: request.caseSensitive,
        wholeWord: request.wholeWord,
        regexp: request.regexp,
        include: request.include,
        exclude: request.exclude,
        signal,
        onFileResult: (result) => {
          this.host.emit({
            type: "file.search.result",
            payload: {
              cwd,
              searchId: request.requestId,
              path: result.path,
              hash: result.hash,
              matches: result.matches,
            },
          });
        },
      });
      respond({
        status: outcome.status,
        error: null,
        fileCount: outcome.fileCount,
        matchCount: outcome.matchCount,
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, query: request.query },
        `Failed to run project search for workspace ${cwd}`,
      );
      respond({ status: "error", error: getErrorMessage(error), fileCount: 0, matchCount: 0 });
    } finally {
      if (this.activeSearchSignal === signal) {
        this.activeSearchSignal = null;
      }
    }
  }

  async handleFileReplaceRequest(request: FileReplaceRequest): Promise<void> {
    const cwd = request.cwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file.replace.response",
        payload: {
          cwd: request.cwd,
          results: [],
          error: "cwd is required",
          requestId: request.requestId,
        },
      });
      return;
    }
    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const results = await replaceInWorkspaceFiles({
        root: cwd,
        replacement: request.replacement,
        files: request.files,
      });
      if (results.some((result) => result.status === "ok")) {
        this.symbolIndex.invalidate(cwd);
      }
      this.host.emit({
        type: "file.replace.response",
        payload: { cwd, results, error: null, requestId: request.requestId },
      });
    } catch (error) {
      this.logger.error({ err: error, cwd }, `Failed to run project replace for workspace ${cwd}`);
      this.host.emit({
        type: "file.replace.response",
        payload: { cwd, results: [], error: getErrorMessage(error), requestId: request.requestId },
      });
    }
  }

  handleFileUploadRequest(request: FileUploadRequest): void {
    this.fileUploads.beginUpload(request);
  }

  /**
   * File-transfer frames feed two stores. They are told apart by which one owns
   * the `requestId`, asked before anything is applied - not by letting one store
   * decline the frame, because `FileUploadStore.receiveFrame` returns null both
   * for "not mine" and for "mine, nothing to report yet", and a frame routed on
   * that would be applied twice.
   */
  async handleFileTransferFrame(frame: FileTransferFrame): Promise<void> {
    if (this.binaryWrites.hasPending(frame.requestId)) {
      const completion = await this.binaryWrites.receiveFrame(frame);
      if (completion) {
        this.noteBinaryWrite(completion.cwd, completion.result);
        this.host.emit({
          type: "fs.file.write_binary.response",
          payload: {
            cwd: completion.cwd,
            path: completion.path,
            result: completion.result,
            requestId: completion.requestId,
          },
        });
      }
      return;
    }

    const response = await this.fileUploads.receiveFrame(frame);
    if (response) {
      this.host.emit(response);
    }
  }

  async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      await this.assertCwdWithinKnownWorkspace(cwd.trim());
      const icon = await getProjectIcon(cwd);
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    this.logger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      await this.assertCwdWithinKnownWorkspace(cwd);
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });

      const entry = this.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: info.path,
          token: entry.token,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }
}
