import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileReadResult } from "@otto-code/client/internal/daemon-client";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import {
  __clearWorkspaceImageCacheForTests,
  loadWorkspaceImage,
  type WorkspaceImageReader,
} from "./workspace-image-cache";
import type { WorkspaceImageBase } from "./workspace-image-source";

const BASE: WorkspaceImageBase = {
  serverId: "s1",
  workspaceRoot: "/home/me/project",
  documentDir: "docs",
};

function stubAttachmentStore(): AttachmentStore {
  return {
    storageType: "web-indexeddb",
    save: async ({ id, mimeType }) =>
      ({
        id: id ?? "generated",
        mimeType: mimeType ?? "image/png",
        storageType: "web-indexeddb",
        storageKey: id ?? "generated",
        createdAt: 0,
      }) satisfies AttachmentMetadata,
    encodeBase64: async () => "",
    resolvePreviewUrl: async () => "blob:stub",
    delete: async () => undefined,
    garbageCollect: async () => undefined,
  };
}

function imageRead(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    size: 3,
    path: "docs/logo.png",
    kind: "image",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reader(result: () => Promise<FileReadResult>): WorkspaceImageReader & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    readFile: async (cwd, path) => {
      calls.push(`${cwd}|${path}`);
      return await result();
    },
  };
}

beforeEach(() => {
  __clearWorkspaceImageCacheForTests();
  __setAttachmentStoreForTests(stubAttachmentStore());
});

describe("loadWorkspaceImage", () => {
  it("reads with the workspace root as the cwd", async () => {
    const daemon = reader(async () => imageRead());

    await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/logo.png" });

    expect(daemon.calls).toEqual(["/home/me/project|docs/logo.png"]);
  });

  it("reads each distinct path once however many times a document names it", async () => {
    const daemon = reader(async () => imageRead());

    const results = await Promise.all([
      loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/logo.png" }),
      loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/logo.png" }),
      loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/other.png" }),
    ]);
    await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/logo.png" });

    expect(daemon.calls).toEqual([
      "/home/me/project|docs/logo.png",
      "/home/me/project|docs/other.png",
    ]);
    expect(results[0]).toBe(results[1]);
  });

  it("refuses a file the daemon did not report as an image", async () => {
    const daemon = reader(async () => imageRead({ kind: "text", mime: "text/plain" }));

    expect(await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/a.png" })).toBeNull();
  });

  it("refuses an image too large to be worth drawing", async () => {
    const daemon = reader(async () =>
      imageRead({ bytes: new Uint8Array(9 * 1024 * 1024), size: 9 * 1024 * 1024 }),
    );

    expect(
      await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/big.png" }),
    ).toBeNull();
  });

  it("treats an unreadable file as an ordinary miss, and lets a later mount retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let attempt = 0;
    const daemon = reader(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("ENOENT");
      }
      return imageRead();
    });

    expect(await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/l.png" })).toBeNull();
    expect(
      await loadWorkspaceImage({ reader: daemon, base: BASE, path: "docs/l.png" }),
    ).not.toBeNull();
    expect(daemon.calls).toHaveLength(2);
    warn.mockRestore();
  });
});
