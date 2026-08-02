import {
  FileTransferOpcode,
  type FileTransferFrame,
} from "@otto-code/protocol/binary-frames/index";
import { getErrorMessage } from "@otto-code/protocol/error-utils";

import type { FsFileWriteBinaryResult } from "../messages.js";
import { writeExplorerBinaryFile } from "./service.js";

/**
 * The daemon half of `fs.file.write_binary` when the bytes arrive as
 * file-transfer frames rather than as base64 inside the request.
 *
 * Modelled on `FileUploadStore`, and different from it in the one way that
 * matters: an upload lands in `$OTTO_HOME/uploads/`, which the daemon owns
 * outright, while this lands in a user workspace at a path the client chose.
 * That is why nothing here opens a file itself. **The whole payload is buffered
 * in memory and handed to `writeExplorerBinaryFile` in one call at FileEnd.**
 * Streaming to disk would be cheaper, but every guarantee that function carries
 * — resolving through `resolveMutationPath` so a symlinked parent cannot walk
 * the bytes out of the workspace, creating parent directories one re-checked
 * segment at a time, and the exclusive `open(…, "wx")` that makes "does not
 * exist" and "create it" a single operation — lives at its open, and a
 * streaming writer would have to reimplement all of it at a second open. One
 * buffered file is the cheaper thing to be right about; these are printed PDFs
 * and pasted images, not archives, and `maxBinaryWriteBytes` caps what a
 * transfer may declare.
 */

/**
 * Ceiling on a single framed write, because this store holds the payload in
 * memory until FileEnd. Generous for what produces these bytes (a printed
 * document, an image off the clipboard) and far below anything that would
 * threaten the daemon.
 */
export const maxBinaryWriteBytes = 64 * 1024 * 1024;

export interface BinaryWriteBegin {
  requestId: string;
  cwd: string;
  /** Workspace-relative, exactly as it arrived. */
  path: string;
  size: number;
  overwrite?: boolean;
  /**
   * The caller's workspace-boundary check, already in flight.
   *
   * Registration has to be synchronous — the frames are behind this request in
   * the socket and a transfer the store does not know about yet is a transfer
   * that gets routed to the upload store and lost — so the check cannot be
   * awaited before `begin`. It is awaited here instead, before a single byte
   * reaches `writeExplorerBinaryFile`, and a rejection drops the buffer the
   * moment it settles rather than at FileEnd.
   */
  guard?: Promise<unknown>;
}

export interface BinaryWriteCompletion {
  requestId: string;
  cwd: string;
  path: string;
  result: FsFileWriteBinaryResult;
}

interface PendingBinaryWrite extends BinaryWriteBegin {
  chunks: Uint8Array[];
  receivedBytes: number;
  started: boolean;
  /** Set once the transfer is doomed; FileEnd reports this instead of writing. */
  failure: string | null;
  staleTimeout: ReturnType<typeof setTimeout>;
}

interface WorkspaceBinaryWriteStoreOptions {
  staleTransferTimeoutMs?: number;
}

export class WorkspaceBinaryWriteStore {
  private static readonly defaultStaleTransferTimeoutMs = 10 * 60 * 1000;

  private readonly staleTransferTimeoutMs: number;
  private readonly pending = new Map<string, PendingBinaryWrite>();

  constructor(options: WorkspaceBinaryWriteStoreOptions = {}) {
    this.staleTransferTimeoutMs =
      options.staleTransferTimeoutMs ?? WorkspaceBinaryWriteStore.defaultStaleTransferTimeoutMs;
  }

  /**
   * Register a transfer. Synchronous on purpose; see `BinaryWriteBegin.guard`.
   */
  begin(request: BinaryWriteBegin): void {
    const existing = this.pending.get(request.requestId);
    if (existing) {
      this.forget(existing);
      existing.chunks = [];
    }

    const transfer: PendingBinaryWrite = {
      ...request,
      chunks: [],
      receivedBytes: 0,
      started: false,
      failure:
        request.size > maxBinaryWriteBytes
          ? `Binary write exceeds the ${maxBinaryWriteBytes}-byte limit: declared ${request.size}.`
          : null,
      staleTimeout: this.createStaleTimeout(request.requestId),
    };
    this.pending.set(request.requestId, transfer);

    request.guard?.then(
      () => undefined,
      (error: unknown) => {
        this.fail(request.requestId, transfer, getErrorMessage(error));
      },
    );
  }

  /**
   * Whether this store owns `requestId`.
   *
   * The router calls this instead of reading meaning into a null from
   * `receiveFrame`: for the upload store null also means "mine, nothing to
   * report yet", so a frame routed on that signal would be applied twice.
   */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Apply one frame. Resolves to a completion at FileEnd, or when the transfer
   * has already failed, and to null while bytes are still arriving.
   *
   * Frame order is the socket's order: everything that mutates the transfer
   * runs before the first `await`, so no queue is needed to keep chunks in
   * sequence the way `FileUploadStore` needs one around its appends.
   */
  receiveFrame(frame: FileTransferFrame): Promise<BinaryWriteCompletion | null> {
    const transfer = this.pending.get(frame.requestId);
    if (!transfer) {
      return Promise.resolve(null);
    }
    this.refreshStaleTimeout(transfer);

    if (frame.opcode === FileTransferOpcode.FileBegin) {
      if (frame.metadata.size !== transfer.size) {
        this.fail(
          frame.requestId,
          transfer,
          `Binary write size disagreement: request declared ${transfer.size}, transfer declared ${frame.metadata.size}.`,
        );
      }
      transfer.started = true;
      return Promise.resolve(null);
    }

    if (frame.opcode === FileTransferOpcode.FileChunk) {
      this.collectChunk(transfer, frame.payload);
      return Promise.resolve(null);
    }

    this.forget(transfer);
    return this.complete(transfer);
  }

  private collectChunk(transfer: PendingBinaryWrite, bytes: Uint8Array): void {
    if (transfer.failure) {
      return;
    }
    if (!transfer.started) {
      transfer.failure = "Binary write chunks arrived before file begin.";
      return;
    }
    const nextReceivedBytes = transfer.receivedBytes + bytes.byteLength;
    if (nextReceivedBytes > transfer.size) {
      // Refused rather than truncated: a stream that outran its declaration is
      // not a file we know the shape of, and half of it is not the answer.
      this.fail(
        transfer.requestId,
        transfer,
        `Binary write exceeded declared size: expected ${transfer.size}, received ${nextReceivedBytes}.`,
      );
      return;
    }
    // Copied, because a frame's payload is a subarray of the receive buffer and
    // holding it would pin the whole buffer for the life of the transfer.
    transfer.chunks.push(new Uint8Array(bytes));
    transfer.receivedBytes = nextReceivedBytes;
  }

  private async complete(transfer: PendingBinaryWrite): Promise<BinaryWriteCompletion> {
    if (transfer.failure) {
      return this.completion(transfer, { status: "error", error: transfer.failure });
    }
    if (transfer.receivedBytes !== transfer.size) {
      return this.completion(transfer, {
        status: "error",
        error: `Binary write size mismatch: expected ${transfer.size}, received ${transfer.receivedBytes}.`,
      });
    }

    try {
      // Settled before the write, never after: the guard is what keeps this
      // from putting bytes outside every known workspace.
      await transfer.guard;
      const bytes = Buffer.concat(transfer.chunks);
      transfer.chunks = [];
      const result = await writeExplorerBinaryFile({
        root: transfer.cwd,
        relativePath: transfer.path,
        bytes,
        overwrite: transfer.overwrite,
      });
      return this.completion(transfer, result);
    } catch (error) {
      return this.completion(transfer, { status: "error", error: getErrorMessage(error) });
    } finally {
      transfer.chunks = [];
    }
  }

  private completion(
    transfer: PendingBinaryWrite,
    result: FsFileWriteBinaryResult,
  ): BinaryWriteCompletion {
    return {
      requestId: transfer.requestId,
      cwd: transfer.cwd,
      path: transfer.path,
      result,
    };
  }

  /**
   * Mark a transfer doomed and release what it has buffered. The record stays
   * so the frames still in flight keep being routed here — and discarded —
   * rather than falling through to the upload store, and so FileEnd still has
   * a reason to report.
   */
  private fail(requestId: string, transfer: PendingBinaryWrite, message: string): void {
    if (this.pending.get(requestId) !== transfer || transfer.failure) {
      return;
    }
    transfer.failure = message;
    transfer.chunks = [];
    transfer.receivedBytes = 0;
  }

  private createStaleTimeout(requestId: string): ReturnType<typeof setTimeout> {
    const timeout = setTimeout(() => {
      const transfer = this.pending.get(requestId);
      if (transfer) {
        // A client that vanished mid-transfer is already gone; there is nobody
        // left to report to, and the buffer is the only thing worth reclaiming.
        this.forget(transfer);
        transfer.chunks = [];
      }
    }, this.staleTransferTimeoutMs);
    timeout.unref?.();
    return timeout;
  }

  private refreshStaleTimeout(transfer: PendingBinaryWrite): void {
    clearTimeout(transfer.staleTimeout);
    transfer.staleTimeout = this.createStaleTimeout(transfer.requestId);
  }

  /** Drop the registration only. The buffer outlives it, through `complete`. */
  private forget(transfer: PendingBinaryWrite): void {
    clearTimeout(transfer.staleTimeout);
    if (this.pending.get(transfer.requestId) === transfer) {
      this.pending.delete(transfer.requestId);
    }
  }
}
