import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { __setAttachmentStoreForTests } from "@/attachments/store";
import { __resetPinnedPreviewAttachmentIdsForTests } from "@/attachments/preview-pins";
import { createPreviewAttachmentId } from "@/attachments/utils";
import {
  EMPTY_ATTACHMENT_STORE_USAGE,
  type AttachmentMetadata,
  type AttachmentStore,
} from "@/attachments/types";
import { useDraftStore } from "./index";

function createCollectingStore(): AttachmentStore & { collected: Array<ReadonlySet<string>> } {
  const collected: Array<ReadonlySet<string>> = [];
  return {
    storageType: "web-indexeddb",
    collected,
    async save(input): Promise<AttachmentMetadata> {
      return {
        id: input.id ?? "att_saved",
        mimeType: input.mimeType ?? "image/png",
        storageType: "web-indexeddb",
        storageKey: input.id ?? "att_saved",
        createdAt: 1700000000000,
      };
    },
    async encodeBase64() {
      return "";
    },
    async resolvePreviewUrl({ attachment }) {
      return `blob:${attachment.id}`;
    },
    async delete() {},
    async garbageCollect({ referencedIds }) {
      collected.push(referencedIds);
    },
    async usage() {
      return EMPTY_ATTACHMENT_STORE_USAGE;
    },
    async clearPreviews() {
      return { deleted: 0, freedBytes: 0 };
    },
  };
}

async function flushScheduledGc(store: { collected: unknown[] }): Promise<void> {
  // GC now serializes behind a persistence barrier (service.ts), so a fixed
  // number of microtask turns is no longer enough to see the call it made.
  await vi.waitFor(() => {
    expect(store.collected.length).toBeGreaterThan(0);
  });
}

describe("draft attachment garbage collection", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
    __resetPinnedPreviewAttachmentIdsForTests();
  });

  it("keeps a rendered browser screenshot alive across the next draft save", async () => {
    const store = createCollectingStore();
    __setAttachmentStoreForTests(store);

    // What the chat does when an assistant markdown image resolves: mint a
    // preview id for the daemon-side file, then persist a local copy under it.
    const screenshotId = createPreviewAttachmentId({
      mimeType: "image/png",
      path: "/tmp/otto-attachments-a1/0123456789abcdef.png",
      size: 4096,
      contentLength: 4096,
    });

    useDraftStore.getState().saveDraftInput({
      draftKey: "workspace-1",
      draft: { text: "next message", attachments: [] },
    });
    await flushScheduledGc(store);

    const [referencedIds] = store.collected;
    expect(referencedIds).toBeDefined();
    expect(Array.from(referencedIds)).toContain(screenshotId);
  });
});
