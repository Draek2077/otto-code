import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@otto-code/protocol/binary-frames/index";
import { CodeIntelligenceSession } from "../code-intelligence/code-intelligence-session.js";
import {
  WorkspaceFilesSession,
  type WorkspaceFilesSessionHost,
} from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeSubsystem(
  options: {
    hasBinaryChannel?: boolean;
    allowedRoots?: string[];
    /** Observe (and optionally stall) each outbound binary frame. */
    emitBinary?: (frame: Uint8Array) => Promise<void> | void;
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const binary: Uint8Array[] = [];
  let hasBinary = options.hasBinaryChannel ?? false;
  const host: WorkspaceFilesSessionHost = {
    emit: (msg) => emitted.push(msg),
    emitBinary: async (frame) => {
      binary.push(frame);
      await options.emitBinary?.(frame);
    },
    hasBinaryChannel: () => hasBinary,
  };
  const ottoHome = makeDir("workspace-files-home-");
  // Every per-test cwd lives under the OS temp root, so treating that root as
  // the sole known workspace lets the boundary guard pass for the happy-path
  // specs while still exercising it. Boundary-rejection specs pass a tighter set.
  const allowedRoots = options.allowedRoots ?? [realpathSync(tmpdir())];
  // The code-navigation specs never reach a language server or the solution
  // subsystem; invalidatePath is the only member the watcher ping touches.
  const solutionService = {
    invalidatePath: () => {},
  } as unknown as import("../../solution-model/service.js").SolutionService;
  const subsystem = new WorkspaceFilesSession({
    host,
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    solutionService,
    ottoHome,
    logger: pino({ level: "silent" }),
    resolveAllowedRoots: async () => allowedRoots,
    // Tight watcher timing so the watch specs stay fast and rely on the
    // deterministic polling path rather than platform fs.watch latency.
    watchOptions: { pollIntervalMs: 40, debounceMs: 10 },
  });
  const codeIntelligence = new CodeIntelligenceSession({
    host: { emit: (msg) => emitted.push(msg) },
    lspService: {} as import("../../lsp/service.js").LspService,
    solutionService,
    symbolIndex: subsystem.symbolIndex,
    assertCwdWithinKnownWorkspace: (cwd) => subsystem.assertCwdWithinKnownWorkspace(cwd),
    logger: pino({ level: "silent" }),
  });
  return {
    subsystem,
    codeIntelligence,
    emitted,
    binary,
    ottoHome,
    setHasBinary: (value: boolean) => {
      hasBinary = value;
    },
  };
}

function transferFrame(args: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const frame = decodeFileTransferFrame(encodeFileTransferFrame(args));
  if (!frame) {
    throw new Error("Expected a file transfer frame");
  }
  return frame;
}

describe("WorkspaceFilesSession", () => {
  test("creates an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-create-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-create",
        },
      },
    ]);
  });

  test("passes entry creation errors through in the response", async () => {
    const cwd = makeDir("workspace-files-create-error-");
    writeFileSync(join(cwd, "notes.txt"), "existing");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryCreateRequest({
      type: "fs.entry.create.request",
      cwd,
      parentPath: ".",
      name: "notes.txt",
      kind: "file",
      requestId: "req-create-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.create.response",
        payload: {
          cwd,
          parentPath: ".",
          path: null,
          success: false,
          error: '"notes.txt" already exists',
          requestId: "req-create-error",
        },
      },
    ]);
  });

  test("renames an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-rename-");
    writeFileSync(join(cwd, "notes.txt"), "rename me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "notes.txt",
      name: "renamed.txt",
      requestId: "req-rename",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(existsSync(join(cwd, "renamed.txt"))).toBe(true);
    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "notes.txt",
          renamedPath: "renamed.txt",
          success: true,
          error: null,
          requestId: "req-rename",
        },
      },
    ]);
  });

  test("passes entry rename errors through in the response", async () => {
    const cwd = makeDir("workspace-files-rename-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryRenameRequest({
      type: "fs.entry.rename.request",
      cwd,
      path: "missing.txt",
      name: "renamed.txt",
      requestId: "req-rename-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.rename.response",
        payload: {
          cwd,
          path: "missing.txt",
          renamedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-rename-error",
        },
      },
    ]);
  });

  test("duplicates an entry and emits the resulting path", async () => {
    const cwd = makeDir("workspace-files-duplicate-");
    writeFileSync(join(cwd, "notes.txt"), "duplicate me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "notes.txt",
      requestId: "req-duplicate",
    });

    expect(readFileSync(join(cwd, "notes copy.txt"), "utf8")).toBe("duplicate me");
    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "notes.txt",
          duplicatedPath: "notes copy.txt",
          success: true,
          error: null,
          requestId: "req-duplicate",
        },
      },
    ]);
  });

  test("passes entry duplication errors through in the response", async () => {
    const cwd = makeDir("workspace-files-duplicate-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDuplicateRequest({
      type: "fs.entry.duplicate.request",
      cwd,
      path: "missing.txt",
      requestId: "req-duplicate-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.duplicate.response",
        payload: {
          cwd,
          path: "missing.txt",
          duplicatedPath: null,
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-duplicate-error",
        },
      },
    ]);
  });

  test("deletes an entry and emits the complete success response", async () => {
    const cwd = makeDir("workspace-files-delete-");
    writeFileSync(join(cwd, "notes.txt"), "delete me");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "notes.txt",
      requestId: "req-delete",
    });

    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "notes.txt",
          success: true,
          error: null,
          requestId: "req-delete",
        },
      },
    ]);
  });

  test("passes entry deletion errors through in the response", async () => {
    const cwd = makeDir("workspace-files-delete-error-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileEntryDeleteRequest({
      type: "fs.entry.delete.request",
      cwd,
      path: "missing.txt",
      requestId: "req-delete-error",
    });

    expect(emitted).toEqual([
      {
        type: "fs.entry.delete.response",
        payload: {
          cwd,
          path: "missing.txt",
          success: false,
          error: "File or folder no longer exists",
          requestId: "req-delete-error",
        },
      },
    ]);
  });

  test("lists directory entries", async () => {
    const cwd = makeDir("workspace-files-list-");
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-list",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.directory).not.toBeNull();
  });

  test("reads file content inline when the client has no binary channel", async () => {
    const cwd = makeDir("workspace-files-read-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: false });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read",
      acceptBinary: true,
    });

    expect(binary).toEqual([]);
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file).not.toBeNull();
  });

  test("streams binary frames when the client accepts binary and has a channel", async () => {
    const cwd = makeDir("workspace-files-binary-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-binary",
      acceptBinary: true,
    });

    expect(emitted).toEqual([]);
    expect(binary).toHaveLength(3);
    const opcodes = binary.map((frame) => decodeFileTransferFrame(frame)?.opcode);
    expect(opcodes).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
      FileTransferOpcode.FileEnd,
    ]);
  });

  test("rejects an over-budget file before opening a binary transfer", async () => {
    const cwd = makeDir("workspace-files-read-budget-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read-budget",
      acceptBinary: true,
      maxBytes: 5,
    });

    expect(binary).toEqual([]);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ error: "File is too large to display" }),
      }),
    ]);
  });

  test("streams a real file larger than the socket limit as paced ordered chunks", async () => {
    const cwd = makeDir("workspace-files-large-binary-");
    const fileBytes = Buffer.alloc(8 * 1024 * 1024 + 123);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    writeFileSync(join(cwd, "large.bin"), fileBytes);

    let releaseFirstChunk: (() => void) | undefined;
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let chunkSends = 0;
    const { subsystem, emitted, binary } = makeSubsystem({
      hasBinaryChannel: true,
      emitBinary: async (frame) => {
        if (decodeFileTransferFrame(frame)?.opcode !== FileTransferOpcode.FileChunk) return;
        chunkSends += 1;
        if (chunkSends === 1) await firstChunkSent;
      },
    });

    const transfer = subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "large.bin",
      mode: "file",
      requestId: "req-large-binary",
      acceptBinary: true,
    });

    await expect.poll(() => chunkSends).toBe(1);
    expect(binary.map((frame) => decodeFileTransferFrame(frame)?.opcode)).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
    ]);

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-unrelated-list",
    });
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ requestId: "req-unrelated-list", error: null }),
      }),
    ]);

    releaseFirstChunk?.();
    await transfer;

    const frames = binary.map((frame) => decodeFileTransferFrame(frame));
    const chunks = frames.flatMap((frame) =>
      frame?.opcode === FileTransferOpcode.FileChunk ? [frame.payload] : [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(
      Buffer.compare(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), fileBytes),
    ).toBe(0);
    expect(frames.at(0)?.opcode).toBe(FileTransferOpcode.FileBegin);
    expect(frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    expect(emitted).toHaveLength(1);
  }, 30_000);

  test("rejects an empty file-explorer cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: "  ",
      path: ".",
      mode: "list",
      requestId: "req-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_explorer_response",
        payload: expect.objectContaining({
          error: "cwd is required",
          directory: null,
          file: null,
          requestId: "req-empty",
        }),
      },
    ]);
  });

  test("issues a download token for a real file", async () => {
    const cwd = makeDir("workspace-files-token-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd,
      path: "report.txt",
      requestId: "req-token",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_token_response") {
      throw new Error(`expected file_download_token_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(typeof message.payload.token).toBe("string");
    expect(message.payload.fileName).toBe("report.txt");
    expect(message.payload.size).toBe(11);
  });

  test("rejects an empty download-token cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: "",
      path: "report.txt",
      requestId: "req-token-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({
          token: null,
          error: "cwd is required",
          requestId: "req-token-empty",
        }),
      },
    ]);
  });

  test("responds to a project icon request", async () => {
    const cwd = makeDir("workspace-files-icon-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleProjectIconRequest({
      type: "project_icon_request",
      cwd,
      requestId: "req-icon",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "project_icon_response") {
      throw new Error(`expected project_icon_response, got ${message.type}`);
    }
    expect(message.payload.cwd).toBe(cwd);
    expect(message.payload.error).toBeNull();
  });

  test("round-trips an upload through transfer frames", async () => {
    const { subsystem, emitted, ottoHome } = makeSubsystem();

    subsystem.handleFileUploadRequest({
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    });
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello world"),
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
    );

    const message = emitted.find((entry) => entry.type === "file.upload.response");
    if (message?.type !== "file.upload.response") {
      throw new Error("expected a file.upload.response message");
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.fileName).toBe("notes.txt");
    expect(readFileSync(join(ottoHome, "uploads", "upload_req-upload", "notes.txt"), "utf8")).toBe(
      "hello world",
    );
  });

  // The binary write shares the upload's transport and not its destination:
  // these bytes land in a workspace, at a path the client named. The two are
  // told apart by which store owns the requestId, so a spec that gets the bytes
  // to the right file has also proven the routing.
  test("lands a chunked binary write in the workspace", async () => {
    const cwd = makeDir("workspace-files-binary-write-");
    const { subsystem, emitted } = makeSubsystem();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

    await subsystem.handleFsFileWriteBinaryRequest({
      type: "fs.file.write_binary.request",
      cwd,
      path: "out/report.pdf",
      size: bytes.byteLength,
      requestId: "req-binary-write",
    });
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-binary-write",
        metadata: {
          mime: "application/octet-stream",
          size: bytes.byteLength,
          encoding: "binary",
          modifiedAt: "2026-08-02T00:00:00.000Z",
        },
      }),
    );
    // Split, because a single-chunk transfer would not prove the bytes are
    // reassembled in order.
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-binary-write",
        payload: bytes.subarray(0, 5),
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-binary-write",
        payload: bytes.subarray(5),
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-binary-write" }),
    );

    const message = emitted.at(-1);
    if (message?.type !== "fs.file.write_binary.response") {
      throw new Error(`expected fs.file.write_binary.response, got ${message?.type}`);
    }
    expect(message.payload.result.status).toBe("written");
    expect(message.payload.path).toBe("out/report.pdf");
    // The parent directory did not exist; the write created it, one contained
    // segment at a time.
    expect(new Uint8Array(readFileSync(join(cwd, "out", "report.pdf")))).toEqual(bytes);
  });

  test("refuses a binary write that overruns its declared size", async () => {
    const cwd = makeDir("workspace-files-binary-overrun-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFsFileWriteBinaryRequest({
      type: "fs.file.write_binary.request",
      cwd,
      path: "over.bin",
      size: 4,
      requestId: "req-binary-overrun",
    });
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-binary-overrun",
        metadata: {
          mime: "application/octet-stream",
          size: 4,
          encoding: "binary",
          modifiedAt: "2026-08-02T00:00:00.000Z",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-binary-overrun",
        payload: new Uint8Array([1, 2, 3, 4, 5]),
      }),
    );
    await subsystem.handleFileTransferFrame(
      transferFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-binary-overrun" }),
    );

    const message = emitted.at(-1);
    if (message?.type !== "fs.file.write_binary.response") {
      throw new Error(`expected fs.file.write_binary.response, got ${message?.type}`);
    }
    expect(message.payload.result).toEqual({
      status: "error",
      error: "Binary write exceeded declared size: expected 4, received 5.",
    });
    // Refused outright, not truncated to the declared length.
    expect(existsSync(join(cwd, "over.bin"))).toBe(false);
  });
});

function sha256Hex(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
}

function mtimeIso(filePath: string): string {
  return statSync(filePath).mtime.toISOString();
}

async function writeRequest(
  subsystem: WorkspaceFilesSession,
  args: {
    cwd: string;
    path: string;
    content: string;
    expectedModifiedAt: string;
    expectedHash?: string;
  },
) {
  await subsystem.handleFileWriteRequest({
    type: "file.write.request",
    requestId: "req-write",
    ...args,
  });
}

function lastWriteResult(emitted: SessionOutboundMessage[]) {
  const message = emitted.at(-1);
  if (message?.type !== "file.write.response") {
    throw new Error(`expected file.write.response, got ${message?.type}`);
  }
  return message.payload.result;
}

describe("WorkspaceFilesSession file.write", () => {
  test("writes when the precondition matches and reports the new identity", async () => {
    const cwd = makeDir("workspace-files-write-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "alpha\n");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: "a.txt",
      content: "alpha\nbeta\n",
      expectedModifiedAt: mtimeIso(filePath),
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "ok") {
      throw new Error(`expected ok, got ${result.status}`);
    }
    expect(readFileSync(filePath, "utf8")).toBe("alpha\nbeta\n");
    expect(result.hash).toBe(sha256Hex("alpha\nbeta\n"));
    expect(result.size).toBe(11);
    expect(result.eol).toBe("lf");
    expect(result.modifiedAt).toBe(mtimeIso(filePath));
  });

  test("returns a conflict and leaves the file untouched when the disk changed", async () => {
    const cwd = makeDir("workspace-files-conflict-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "disk version\n");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: "a.txt",
      content: "my version\n",
      expectedModifiedAt: "2000-01-01T00:00:00.000Z",
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "conflict") {
      throw new Error(`expected conflict, got ${result.status}`);
    }
    expect(readFileSync(filePath, "utf8")).toBe("disk version\n");
    expect(result.content).toBe("disk version\n");
    expect(result.hash).toBe(sha256Hex("disk version\n"));
    expect(result.modifiedAt).toBe(mtimeIso(filePath));
  });

  test("a matching hash overrides a stale mtime precondition", async () => {
    const cwd = makeDir("workspace-files-hash-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "alpha\n");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: "a.txt",
      content: "beta\n",
      expectedModifiedAt: "2000-01-01T00:00:00.000Z",
      expectedHash: sha256Hex("alpha\n"),
    });

    expect(lastWriteResult(emitted).status).toBe("ok");
    expect(readFileSync(filePath, "utf8")).toBe("beta\n");
  });

  test("refuses to write outside the workspace root", async () => {
    const outer = makeDir("workspace-files-outer-");
    const cwd = makeDir("workspace-files-escape-");
    const outsidePath = join(outer, "victim.txt");
    writeFileSync(outsidePath, "safe");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: relative(cwd, outsidePath),
      content: "pwned",
      expectedModifiedAt: mtimeIso(outsidePath),
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "error") {
      throw new Error(`expected error, got ${result.status}`);
    }
    expect(readFileSync(outsidePath, "utf8")).toBe("safe");
  });

  test("re-applies CRLF endings so LF-normalized content round-trips byte-identical", async () => {
    const cwd = makeDir("workspace-files-crlf-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "one\r\ntwo\r\n");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: "a.txt",
      content: "one\ntwo\nthree\n",
      expectedModifiedAt: mtimeIso(filePath),
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "ok") {
      throw new Error(`expected ok, got ${result.status}`);
    }
    expect(result.eol).toBe("crlf");
    expect(readFileSync(filePath, "utf8")).toBe("one\r\ntwo\r\nthree\r\n");
  });

  test("errors without creating anything when the file no longer exists", async () => {
    const cwd = makeDir("workspace-files-missing-");
    const { subsystem, emitted } = makeSubsystem();

    await writeRequest(subsystem, {
      cwd,
      path: "gone.txt",
      content: "content",
      expectedModifiedAt: "2000-01-01T00:00:00.000Z",
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "error") {
      throw new Error(`expected error, got ${result.status}`);
    }
    expect(result.message).toBe("File no longer exists on disk");
    expect(existsSync(join(cwd, "gone.txt"))).toBe(false);
  });

  test("allowCreate re-creates a deleted file with the requested EOL", async () => {
    const cwd = makeDir("workspace-files-recreate-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileWriteRequest({
      type: "file.write.request",
      requestId: "req-recreate",
      cwd,
      path: "gone.txt",
      content: "one\ntwo\n",
      expectedModifiedAt: "2000-01-01T00:00:00.000Z",
      allowCreate: true,
      eol: "crlf",
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "ok") {
      throw new Error(`expected ok, got ${result.status}`);
    }
    expect(result.eol).toBe("crlf");
    expect(readFileSync(join(cwd, "gone.txt"), "utf8")).toBe("one\r\ntwo\r\n");
  });

  test("allowCreate still runs the precondition when the file exists", async () => {
    const cwd = makeDir("workspace-files-recreate-exists-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "someone else\n");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileWriteRequest({
      type: "file.write.request",
      requestId: "req-recreate-exists",
      cwd,
      path: "a.txt",
      content: "mine\n",
      expectedModifiedAt: "2000-01-01T00:00:00.000Z",
      allowCreate: true,
    });

    const result = lastWriteResult(emitted);
    expect(result.status).toBe("conflict");
    expect(readFileSync(filePath, "utf8")).toBe("someone else\n");
  });

  test("text file reads carry the editor baseline (eol + hash)", async () => {
    const cwd = makeDir("workspace-files-baseline-");
    writeFileSync(join(cwd, "a.txt"), "one\r\ntwo\r\n");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "a.txt",
      mode: "file",
      requestId: "req-baseline",
    });

    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.file?.eol).toBe("crlf");
    expect(message.payload.file?.hash).toBe(sha256Hex("one\r\ntwo\r\n"));
  });
});

function watchEvents(emitted: SessionOutboundMessage[]) {
  return emitted
    .filter(
      (message): message is Extract<SessionOutboundMessage, { type: "file.watch.event" }> =>
        message.type === "file.watch.event",
    )
    .map((message) => message.payload);
}

function hasWatchChange(
  emitted: SessionOutboundMessage[],
  change: "changed" | "deleted" | "recreated",
): boolean {
  return watchEvents(emitted).some((event) => event.change === change);
}

async function subscribeWatch(
  subsystem: WorkspaceFilesSession,
  emitted: SessionOutboundMessage[],
  input: { cwd: string; path: string },
): Promise<{ ok: boolean; error: string | null }> {
  await subsystem.handleFileWatchSubscribeRequest({
    type: "file.watch.subscribe.request",
    requestId: "req-watch-subscribe",
    ...input,
  });
  const response = emitted.find((message) => message.type === "file.watch.subscribe.response");
  if (response?.type !== "file.watch.subscribe.response") {
    throw new Error("expected a file.watch.subscribe.response");
  }
  return { ok: response.payload.ok, error: response.payload.error };
}

describe("WorkspaceFilesSession file.watch", () => {
  test("emits changed with the fresh identity when the file is modified", async () => {
    const cwd = makeDir("workspace-files-watch-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "alpha\n");
    const { subsystem, emitted } = makeSubsystem();

    expect(await subscribeWatch(subsystem, emitted, { cwd, path: "a.txt" })).toEqual({
      ok: true,
      error: null,
    });

    writeFileSync(filePath, "alpha\nbeta\n");

    await expect.poll(() => watchEvents(emitted).length, { timeout: 5_000 }).toBeGreaterThan(0);
    const event = watchEvents(emitted).at(-1);
    expect(event?.change).toBe("changed");
    expect(event?.hash).toBe(sha256Hex("alpha\nbeta\n"));
    expect(event?.path).toBe("a.txt");
    subsystem.dispose();
  });

  test("emits deleted and then recreated across a delete/rewrite cycle", async () => {
    const cwd = makeDir("workspace-files-watch-del-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "alpha\n");
    const { subsystem, emitted } = makeSubsystem();

    await subscribeWatch(subsystem, emitted, { cwd, path: "a.txt" });

    unlinkSync(filePath);
    await expect.poll(() => hasWatchChange(emitted, "deleted"), { timeout: 5_000 }).toBe(true);

    writeFileSync(filePath, "back\n");
    await expect.poll(() => hasWatchChange(emitted, "recreated"), { timeout: 5_000 }).toBe(true);
    const recreated = watchEvents(emitted).find((event) => event.change === "recreated");
    expect(recreated?.hash).toBe(sha256Hex("back\n"));
    subsystem.dispose();
  });

  test("rejects watch subscriptions outside the workspace root", async () => {
    const outer = makeDir("workspace-files-watch-outer-");
    const cwd = makeDir("workspace-files-watch-escape-");
    writeFileSync(join(outer, "victim.txt"), "safe");
    const { subsystem, emitted } = makeSubsystem();

    const result = await subscribeWatch(subsystem, emitted, {
      cwd,
      path: relative(cwd, join(outer, "victim.txt")),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Access outside of workspace is not allowed");
    subsystem.dispose();
  });

  test("unsubscribe stops further events", async () => {
    const cwd = makeDir("workspace-files-watch-unsub-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "alpha\n");
    const { subsystem, emitted } = makeSubsystem();

    await subscribeWatch(subsystem, emitted, { cwd, path: "a.txt" });
    subsystem.handleFileWatchUnsubscribeRequest({
      type: "file.watch.unsubscribe.request",
      requestId: "req-watch-unsub",
      cwd,
      path: "a.txt",
    });

    writeFileSync(filePath, "alpha\nbeta\n");
    // 5x the poll interval: long enough that a live watcher would have fired.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(watchEvents(emitted)).toEqual([]);
    subsystem.dispose();
  });
});

function searchResults(emitted: SessionOutboundMessage[]) {
  return emitted
    .filter(
      (message): message is Extract<SessionOutboundMessage, { type: "file.search.result" }> =>
        message.type === "file.search.result",
    )
    .map((message) => message.payload);
}

function searchSummary(emitted: SessionOutboundMessage[]) {
  const message = emitted.find((entry) => entry.type === "file.search.response");
  if (message?.type !== "file.search.response") {
    throw new Error("expected a file.search.response");
  }
  return message.payload;
}

async function runSearch(
  subsystem: WorkspaceFilesSession,
  input: {
    cwd: string;
    query: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regexp?: boolean;
    include?: string;
    exclude?: string;
  },
): Promise<void> {
  await subsystem.handleFileSearchRequest({
    type: "file.search.request",
    requestId: "req-search",
    ...input,
  });
}

describe("WorkspaceFilesSession file.search", () => {
  test("streams grouped matches with coordinates and respects .gitignore", async () => {
    const cwd = makeDir("workspace-files-search-");
    writeFileSync(join(cwd, ".gitignore"), "dist/\nsecret.txt\n");
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "dist"));
    mkdirSync(join(cwd, ".git"));
    writeFileSync(join(cwd, "src", "app.ts"), "const needle = 1;\nconst other = needle;\n");
    writeFileSync(join(cwd, "dist", "bundle.js"), "needle needle needle\n");
    writeFileSync(join(cwd, "secret.txt"), "needle\n");
    writeFileSync(join(cwd, ".git", "config"), "needle\n");
    const { subsystem, emitted } = makeSubsystem();

    await runSearch(subsystem, { cwd, query: "needle" });

    const summary = searchSummary(emitted);
    expect(summary.status).toBe("completed");
    expect(summary.fileCount).toBe(1);
    expect(summary.matchCount).toBe(2);

    const results = searchResults(emitted);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("src/app.ts");
    expect(results[0].hash).toBe(sha256Hex("const needle = 1;\nconst other = needle;\n"));
    expect(results[0].matches[0]).toMatchObject({ line: 1, column: 7, length: 6 });
    expect(results[0].matches[1]).toMatchObject({ line: 2, column: 15, length: 6 });
    expect(results[0].matches[0].lineText).toBe("const needle = 1;");
  });

  test("honors case, whole-word, and regex flags", async () => {
    const cwd = makeDir("workspace-files-search-flags-");
    writeFileSync(join(cwd, "a.txt"), "Note notes NOTE denote\n");
    const { subsystem, emitted } = makeSubsystem();

    await runSearch(subsystem, { cwd, query: "note", caseSensitive: true, wholeWord: true });
    expect(searchSummary(emitted).matchCount).toBe(0);

    emitted.length = 0;
    await runSearch(subsystem, { cwd, query: "Note", caseSensitive: true, wholeWord: true });
    expect(searchSummary(emitted).matchCount).toBe(1);

    emitted.length = 0;
    await runSearch(subsystem, { cwd, query: "N[Oo]TE", regexp: true, caseSensitive: true });
    expect(searchSummary(emitted).matchCount).toBe(1);
  });

  test("reports invalid regex as an error summary", async () => {
    const cwd = makeDir("workspace-files-search-badre-");
    writeFileSync(join(cwd, "a.txt"), "x\n");
    const { subsystem, emitted } = makeSubsystem();

    await runSearch(subsystem, { cwd, query: "([", regexp: true });
    const summary = searchSummary(emitted);
    expect(summary.status).toBe("error");
    expect(summary.error).toBeTruthy();
  });

  test("skips binary files and honors include/exclude globs", async () => {
    const cwd = makeDir("workspace-files-search-globs-");
    writeFileSync(join(cwd, "keep.ts"), "needle\n");
    writeFileSync(join(cwd, "skip.md"), "needle\n");
    writeFileSync(join(cwd, "blob.bin"), Buffer.from([0, 110, 101, 101, 100, 108, 101, 0]));
    const { subsystem, emitted } = makeSubsystem();

    await runSearch(subsystem, { cwd, query: "needle", include: "*.ts" });
    expect(searchResults(emitted).map((result) => result.path)).toEqual(["keep.ts"]);

    emitted.length = 0;
    await runSearch(subsystem, { cwd, query: "needle", exclude: "*.md" });
    expect(
      searchResults(emitted)
        .map((result) => result.path)
        .sort(),
    ).toEqual(["keep.ts"]);
  });
});

function replaceResults(emitted: SessionOutboundMessage[]) {
  const message = emitted.find((entry) => entry.type === "file.replace.response");
  if (message?.type !== "file.replace.response") {
    throw new Error("expected a file.replace.response");
  }
  return message.payload;
}

describe("WorkspaceFilesSession file.replace", () => {
  test("applies selected matches bottom-up and preserves CRLF", async () => {
    const cwd = makeDir("workspace-files-replace-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "old one\r\nkeep old\r\nold two\r\n");
    const hash = sha256Hex("old one\r\nkeep old\r\nold two\r\n");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileReplaceRequest({
      type: "file.replace.request",
      requestId: "req-replace",
      cwd,
      replacement: "new",
      files: [
        {
          path: "a.txt",
          expectedHash: hash,
          // Only lines 1 and 3 selected - line 2's "old" must survive.
          matches: [
            { line: 1, column: 1, length: 3 },
            { line: 3, column: 1, length: 3 },
          ],
        },
      ],
    });

    const payload = replaceResults(emitted);
    expect(payload.error).toBeNull();
    expect(payload.results[0]).toMatchObject({ status: "ok", path: "a.txt", replacedCount: 2 });
    expect(readFileSync(filePath, "utf8")).toBe("new one\r\nkeep old\r\nnew two\r\n");
  });

  test("skips files whose hash changed since the preview", async () => {
    const cwd = makeDir("workspace-files-replace-stale-");
    const filePath = join(cwd, "a.txt");
    writeFileSync(filePath, "old\n");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileReplaceRequest({
      type: "file.replace.request",
      requestId: "req-replace-stale",
      cwd,
      replacement: "new",
      files: [
        {
          path: "a.txt",
          expectedHash: sha256Hex("something else entirely\n"),
          matches: [{ line: 1, column: 1, length: 3 }],
        },
      ],
    });

    const payload = replaceResults(emitted);
    expect(payload.results[0].status).toBe("skipped");
    expect(readFileSync(filePath, "utf8")).toBe("old\n");
  });

  test("refuses replacements outside the workspace root", async () => {
    const outer = makeDir("workspace-files-replace-outer-");
    const cwd = makeDir("workspace-files-replace-escape-");
    const outsidePath = join(outer, "victim.txt");
    writeFileSync(outsidePath, "old\n");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileReplaceRequest({
      type: "file.replace.request",
      requestId: "req-replace-escape",
      cwd,
      replacement: "pwned",
      files: [
        {
          path: relative(cwd, outsidePath),
          expectedHash: sha256Hex("old\n"),
          matches: [{ line: 1, column: 1, length: 3 }],
        },
      ],
    });

    const payload = replaceResults(emitted);
    expect(payload.results[0].status).toBe("error");
    expect(readFileSync(outsidePath, "utf8")).toBe("old\n");
  });
});

async function listCodeFiles(
  subsystem: CodeIntelligenceSession,
  emitted: SessionOutboundMessage[],
  cwd: string,
) {
  await subsystem.handleCodeListFilesRequest({
    type: "code.list_files.request",
    requestId: "req-list-files",
    cwd,
  });
  const message = emitted.find((entry) => entry.type === "code.list_files.response");
  if (message?.type !== "code.list_files.response") {
    throw new Error("expected a code.list_files.response");
  }
  return message.payload;
}

describe("WorkspaceFilesSession code navigation", () => {
  test("lists non-ignored files for the fuzzy finder", async () => {
    const cwd = makeDir("workspace-files-codelist-");
    writeFileSync(join(cwd, ".gitignore"), "dist/\n");
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "dist"));
    mkdirSync(join(cwd, ".git"));
    writeFileSync(join(cwd, "src", "app.ts"), "export const a = 1;\n");
    writeFileSync(join(cwd, "readme.md"), "# hi\n");
    writeFileSync(join(cwd, "dist", "bundle.js"), "ignored\n");
    writeFileSync(join(cwd, ".git", "config"), "x\n");
    const { codeIntelligence, emitted } = makeSubsystem();

    const payload = await listCodeFiles(codeIntelligence, emitted, cwd);
    expect(payload.error).toBeNull();
    expect(payload.files).toEqual([".gitignore", "readme.md", "src/app.ts"]);
  });

  test("resolves a symbol to its definition location and refreshes after edits", async () => {
    const cwd = makeDir("workspace-files-symbols-");
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "widget.ts"), "export function render() {}\nconst other = 1;\n");
    const { subsystem, codeIntelligence, emitted } = makeSubsystem();

    await codeIntelligence.handleCodeSymbolsRequest({
      type: "code.symbols.request",
      requestId: "req-symbols",
      cwd,
      name: "render",
    });
    const first = emitted.find((entry) => entry.type === "code.symbols.response");
    if (first?.type !== "code.symbols.response") {
      throw new Error("expected a code.symbols.response");
    }
    expect(first.payload.locations).toHaveLength(1);
    expect(first.payload.locations[0]).toMatchObject({
      path: "src/widget.ts",
      name: "render",
      kind: "function",
      line: 1,
    });

    // A write invalidates the index; the renamed symbol resolves.
    const filePath = join(cwd, "src", "widget.ts");
    const currentHash = sha256Hex("export function render() {}\nconst other = 1;\n");
    await subsystem.handleFileWriteRequest({
      type: "file.write.request",
      requestId: "req-symbols-write",
      cwd,
      path: "src/widget.ts",
      content: "export function paint() {}\nconst other = 1;\n",
      expectedModifiedAt: statSync(filePath).mtime.toISOString(),
      expectedHash: currentHash,
    });

    emitted.length = 0;
    await codeIntelligence.handleCodeSymbolsRequest({
      type: "code.symbols.request",
      requestId: "req-symbols-2",
      cwd,
      name: "paint",
    });
    const second = emitted.find((entry) => entry.type === "code.symbols.response");
    if (second?.type !== "code.symbols.response") {
      throw new Error("expected a code.symbols.response");
    }
    expect(second.payload.locations.map((loc) => loc.name)).toEqual(["paint"]);
  });

  test("returns a single file's outline", async () => {
    const cwd = makeDir("workspace-files-outline-");
    writeFileSync(join(cwd, "mod.ts"), "class Alpha {}\nfunction beta() {}\nconst gamma = 3;\n");
    const { codeIntelligence, emitted } = makeSubsystem();

    await codeIntelligence.handleCodeOutlineRequest({
      type: "code.outline.request",
      requestId: "req-outline",
      cwd,
      path: "mod.ts",
    });
    const message = emitted.find((entry) => entry.type === "code.outline.response");
    if (message?.type !== "code.outline.response") {
      throw new Error("expected a code.outline.response");
    }
    const kinds = message.payload.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
    expect(kinds).toContain("class:Alpha");
    expect(kinds).toContain("function:beta");
  });
});

describe("WorkspaceFilesSession known-workspace boundary", () => {
  test("opens files from any known workspace, not just the first", async () => {
    // Two distinct, unrelated workspace roots: the client may open files from
    // either. This is the cross-workspace access the feature enables.
    const workspaceA = makeDir("workspace-files-known-a-");
    const workspaceB = makeDir("workspace-files-known-b-");
    writeFileSync(join(workspaceA, "a.txt"), "alpha");
    writeFileSync(join(workspaceB, "b.txt"), "beta");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [workspaceA, workspaceB] });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: workspaceB,
      path: "b.txt",
      mode: "file",
      requestId: "req-known-b",
    });

    const message = emitted.at(-1);
    if (message?.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message?.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.content).toBe("beta");
  });

  test("opens files inside a subdirectory of a known workspace root", async () => {
    const workspace = makeDir("workspace-files-known-sub-");
    mkdirSync(join(workspace, "pkg"));
    // A caller may address a nested checkout with the nested cwd; it is still
    // inside a known workspace, so it is allowed.
    writeFileSync(join(workspace, "pkg", "nested.txt"), "nested");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [workspace] });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: join(workspace, "pkg"),
      path: "nested.txt",
      mode: "file",
      requestId: "req-known-nested",
    });

    const message = emitted.at(-1);
    if (message?.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message?.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.content).toBe("nested");
  });

  test("refuses to LIST a directory that is not a known workspace", async () => {
    const known = makeDir("workspace-files-known-only-");
    const stranger = makeDir("workspace-files-stranger-");
    writeFileSync(join(stranger, "secret.txt"), "secret");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: stranger,
      path: ".",
      mode: "list",
      requestId: "req-stranger-list",
    });

    const message = emitted.at(-1);
    if (message?.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message?.type}`);
    }
    expect(message.payload.error).toBe("Access outside of known workspaces is not allowed");
    expect(message.payload.directory).toBeNull();
  });

  // Single-file read/write/watch are exempt from the known-workspace boundary so
  // any file on the host can be previewed/edited (bounded by OS permissions).

  test("reads a single file outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-only-");
    const stranger = makeDir("workspace-files-stranger-");
    writeFileSync(join(stranger, "secret.txt"), "secret");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: stranger,
      path: "secret.txt",
      mode: "file",
      requestId: "req-stranger",
    });

    const message = emitted.at(-1);
    if (message?.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message?.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.content).toBe("secret");
  });

  test("writes a single file outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-write-");
    const stranger = makeDir("workspace-files-stranger-write-");
    const target = join(stranger, "plan.txt");
    writeFileSync(target, "draft");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileWriteRequest({
      type: "file.write.request",
      requestId: "req-stranger-write",
      cwd: stranger,
      path: "plan.txt",
      content: "revised",
      expectedModifiedAt: mtimeIso(target),
    });

    const result = lastWriteResult(emitted);
    if (result.status !== "ok") {
      throw new Error(`expected ok, got ${result.status}`);
    }
    expect(readFileSync(target, "utf8")).toBe("revised");
  });

  test("watches a single file outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-watch-");
    const stranger = makeDir("workspace-files-stranger-watch-");
    writeFileSync(join(stranger, "a.txt"), "alpha\n");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    const result = await subscribeWatch(subsystem, emitted, { cwd: stranger, path: "a.txt" });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    subsystem.dispose();
  });

  // ...but the mutation RPCs are NOT exempt. Reading and editing a stray file is
  // a deliberate affordance; creating, renaming and unlinking one on any path
  // the host can reach is not, so all three take the boundary guard.
  test("refuses to create outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-create-");
    const stranger = makeDir("workspace-files-stranger-create-");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileCreateRequest({
      type: "file.create.request",
      cwd: stranger,
      path: "planted.txt",
      kind: "file",
      requestId: "req-stranger-create",
    });

    expect(lastMutationResult(emitted, "file.create.response")).toEqual({
      status: "error",
      message: "Access outside of known workspaces is not allowed",
    });
    expect(existsSync(join(stranger, "planted.txt"))).toBe(false);
  });

  test("refuses to delete outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-delete-");
    const stranger = makeDir("workspace-files-stranger-delete-");
    writeFileSync(join(stranger, "secret.txt"), "secret");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileDeleteRequest({
      type: "file.delete.request",
      cwd: stranger,
      path: "secret.txt",
      requestId: "req-stranger-delete",
    });

    expect(lastMutationResult(emitted, "file.delete.response")).toEqual({
      status: "error",
      message: "Access outside of known workspaces is not allowed",
    });
    expect(readFileSync(join(stranger, "secret.txt"), "utf8")).toBe("secret");
  });

  test("refuses to rename outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-rename-");
    const stranger = makeDir("workspace-files-stranger-rename-");
    writeFileSync(join(stranger, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFileRenameRequest({
      type: "file.rename.request",
      cwd: stranger,
      path: "a.txt",
      newPath: "b.txt",
      requestId: "req-stranger-rename",
    });

    expect(lastMutationResult(emitted, "file.rename.response")).toEqual({
      status: "error",
      message: "Access outside of known workspaces is not allowed",
    });
    expect(existsSync(join(stranger, "a.txt"))).toBe(true);
  });

  // The binary write takes the same boundary guard, and needs it more than the
  // three above: those act on names that already exist, while this one puts new
  // bytes wherever it is pointed.
  test("refuses to write bytes outside every known workspace", async () => {
    const known = makeDir("workspace-files-known-binary-");
    const stranger = makeDir("workspace-files-stranger-binary-");
    const { subsystem, emitted } = makeSubsystem({ allowedRoots: [known] });

    await subsystem.handleFsFileWriteBinaryRequest({
      type: "fs.file.write_binary.request",
      cwd: stranger,
      path: "planted.pdf",
      contentBase64: Buffer.from([0x25, 0x50, 0x44, 0x46]).toString("base64"),
      requestId: "req-stranger-binary",
    });

    const message = emitted.at(-1);
    if (message?.type !== "fs.file.write_binary.response") {
      throw new Error(`expected fs.file.write_binary.response, got ${message?.type}`);
    }
    expect(message.payload.result).toEqual({
      status: "error",
      error: "Access outside of known workspaces is not allowed",
    });
    expect(existsSync(join(stranger, "planted.pdf"))).toBe(false);
  });
});

function lastMutationResult(
  emitted: SessionOutboundMessage[],
  type: "file.create.response" | "file.delete.response" | "file.rename.response",
) {
  const message = emitted.at(-1);
  if (message?.type !== type) {
    throw new Error(`expected ${type}, got ${message?.type}`);
  }
  return message.payload.result;
}

describe("WorkspaceFilesSession file mutations", () => {
  test("creates a file inside a known workspace", async () => {
    const cwd = makeDir("workspace-files-create-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileCreateRequest({
      type: "file.create.request",
      cwd,
      path: "notes.txt",
      kind: "file",
      requestId: "req-create",
    });

    expect(lastMutationResult(emitted, "file.create.response")).toMatchObject({
      status: "ok",
      path: "notes.txt",
      kind: "file",
    });
    expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe("");
  });

  test("reports a non-empty directory rather than wiping it", async () => {
    const cwd = makeDir("workspace-files-delete-guard-");
    mkdirSync(join(cwd, "pkg"));
    writeFileSync(join(cwd, "pkg", "index.ts"), "export {};");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDeleteRequest({
      type: "file.delete.request",
      cwd,
      path: "pkg",
      requestId: "req-delete-guard",
    });

    expect(lastMutationResult(emitted, "file.delete.response")).toEqual({ status: "not_empty" });
    expect(existsSync(join(cwd, "pkg", "index.ts"))).toBe(true);
  });

  test("moves a file into another directory", async () => {
    const cwd = makeDir("workspace-files-rename-");
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileRenameRequest({
      type: "file.rename.request",
      cwd,
      path: "a.txt",
      newPath: "src/a.txt",
      requestId: "req-rename",
    });

    expect(lastMutationResult(emitted, "file.rename.response")).toEqual({
      status: "ok",
      from: "a.txt",
      to: "src/a.txt",
      kind: "file",
    });
    expect(readFileSync(join(cwd, "src", "a.txt"), "utf8")).toBe("alpha");
    expect(existsSync(join(cwd, "a.txt"))).toBe(false);
  });

  test("surfaces an empty cwd as an error result", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDeleteRequest({
      type: "file.delete.request",
      cwd: "  ",
      path: "a.txt",
      requestId: "req-delete-empty",
    });

    expect(lastMutationResult(emitted, "file.delete.response")).toEqual({
      status: "error",
      message: "cwd is required",
    });
  });
});
