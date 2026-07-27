import { describe, expect, it } from "vitest";
import { createLocalFileAttachmentStore } from "./local-file-attachment-store";
import { createTestAttachmentFileSystem } from "./test-attachment-file-system";

describe("local file attachment store", () => {
  it("writes raw byte sources directly to the managed file path", async () => {
    const fileSystem = createTestAttachmentFileSystem();
    const store = createLocalFileAttachmentStore({
      storageType: "native-file",
      baseDirectoryName: "preview-assets",
      fileSystem,
      resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
    });

    const attachment = await store.save({
      id: "preview_8_test",
      mimeType: "image/png",
      fileName: "result.png",
      source: { kind: "bytes", bytes: new Uint8Array([0, 1, 2, 3]) },
    });

    expect(attachment).toMatchObject({
      id: "preview_8_test",
      mimeType: "image/png",
      storageType: "native-file",
      storageKey: "/cache/preview-assets/preview_8_test.png",
      fileName: "result.png",
      byteSize: 4,
    });
    expect(fileSystem.files.get("file:///cache/preview-assets/preview_8_test.png")).toEqual(
      new Uint8Array([0, 1, 2, 3]),
    );
    expect(fileSystem.directories.has("file:///cache/preview-assets")).toBe(true);
  });

  it("reports previews and sent attachments as separate totals", async () => {
    const store = createStore();
    await savePreview(store, "preview_4_a", 4);
    await saveSent(store, "att_sent_1", 10);

    await expect(store.usage()).resolves.toEqual({
      previewCount: 1,
      previewBytes: 4,
      otherCount: 1,
      otherBytes: 10,
    });
  });

  it("clears previews and leaves what the user attached", async () => {
    const store = createStore();
    await savePreview(store, "preview_4_a", 4);
    await savePreview(store, "preview_6_b", 6);
    const sent = await saveSent(store, "att_sent_1", 10);

    await expect(store.clearPreviews()).resolves.toEqual({ deleted: 2, freedBytes: 10 });
    await expect(store.usage()).resolves.toEqual({
      previewCount: 0,
      previewBytes: 0,
      otherCount: 1,
      otherBytes: 10,
    });
    // The sent attachment is still readable, not merely still counted.
    await expect(store.encodeBase64({ attachment: sent })).resolves.toBeTypeOf("string");
  });

  it("reads an empty store as zero rather than failing", async () => {
    await expect(createStore().usage()).resolves.toEqual({
      previewCount: 0,
      previewBytes: 0,
      otherCount: 0,
      otherBytes: 0,
    });
  });
});

function createStore() {
  return createLocalFileAttachmentStore({
    storageType: "native-file",
    baseDirectoryName: "preview-assets",
    fileSystem: createTestAttachmentFileSystem(),
    resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
  });
}

function savePreview(store: ReturnType<typeof createStore>, id: string, byteLength: number) {
  return store.save({
    id,
    mimeType: "image/png",
    source: { kind: "bytes", bytes: new Uint8Array(byteLength) },
  });
}

function saveSent(store: ReturnType<typeof createStore>, id: string, byteLength: number) {
  return store.save({
    id,
    mimeType: "image/png",
    source: { kind: "bytes", bytes: new Uint8Array(byteLength) },
  });
}
