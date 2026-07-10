import type pino from "pino";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@otto-code/protocol/binary-frames/index";
import type {
  CodeListFilesRequest,
  CodeOutlineRequest,
  CodeSymbolsRequest,
  FileDownloadTokenRequest,
  FileExplorerRequest,
  FileReplaceRequest,
  FileSearchRequest,
  FileSearchSummary,
  FileUploadRequest,
  FileWatchSubscribeRequest,
  FileWatchUnsubscribeRequest,
  FileWriteRequest,
  FileWriteResult,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  readExplorerFileBytes,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import { SessionFileWatcher } from "../../file-explorer/file-watcher.js";
import { replaceInWorkspaceFiles, searchWorkspaceFiles } from "../../file-explorer/file-search.js";
import {
  getFileOutline,
  listWorkspaceFiles,
  WorkspaceSymbolIndex,
} from "../../file-explorer/code-index.js";
import { getProjectIcon } from "../../../utils/project-icon.js";

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  emit(msg: SessionOutboundMessage): void;
  emitBinary(frame: Uint8Array): void;
  hasBinaryChannel(): boolean;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  ottoHome: string;
  logger: pino.Logger;
  /** Test hook: tighten the watcher's timing so specs stay fast. */
  watchOptions?: { pollIntervalMs?: number; debounceMs?: number };
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly logger: pino.Logger;
  private readonly fileUploads: FileUploadStore;
  private readonly fileWatcher: SessionFileWatcher;
  private readonly symbolIndex = new WorkspaceSymbolIndex();
  private activeSearchSignal: { superseded: boolean } | null = null;

  constructor(options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({ ottoHome: options.ottoHome });
    this.fileWatcher = new SessionFileWatcher({
      logger: options.logger,
      emitEvent: (event) => {
        this.host.emit({ type: "file.watch.event", payload: event });
      },
      ...options.watchOptions,
    });
  }

  dispose(): void {
    this.fileWatcher.dispose();
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

  async handleFileExplorerRequest(request: FileExplorerRequest): Promise<void> {
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
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          const file = await readExplorerFileBytes({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emitBinary(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileBegin,
              requestId,
              metadata: {
                mime: file.mimeType,
                size: file.size,
                encoding: file.encoding,
                modifiedAt: file.modifiedAt,
              },
            }),
          );
          this.host.emitBinary(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileChunk,
              requestId,
              payload: file.bytes,
            }),
          );
          this.host.emitBinary(
            encodeFileTransferFrame({
              opcode: FileTransferOpcode.FileEnd,
              requestId,
            }),
          );
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

  handleFileUploadRequest(request: FileUploadRequest): void {
    this.fileUploads.beginUpload(request);
  }

  async handleFileTransferFrame(frame: FileTransferFrame): Promise<void> {
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
