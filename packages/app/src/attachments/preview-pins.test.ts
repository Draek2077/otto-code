import { afterEach, describe, expect, it } from "vitest";

import { createPreviewAttachmentId } from "./utils";
import {
  __resetPinnedPreviewAttachmentIdsForTests,
  collectPinnedPreviewAttachmentIds,
  pinPreviewAttachmentId,
} from "./preview-pins";

function pinned(): string[] {
  const ids = new Set<string>();
  collectPinnedPreviewAttachmentIds(ids);
  return Array.from(ids);
}

describe("preview attachment pins", () => {
  afterEach(() => {
    __resetPinnedPreviewAttachmentIdsForTests();
  });

  it("pins the id when a preview attachment is minted", () => {
    const id = createPreviewAttachmentId({
      mimeType: "image/png",
      path: "/tmp/otto-attachments-a1/screenshot.png",
      size: 2048,
      contentLength: 2048,
    });

    expect(pinned()).toContain(id);
  });

  it("keeps the same file pinned across repeated reads of one image", () => {
    const input = {
      mimeType: "image/png",
      path: "/tmp/otto-attachments-a1/screenshot.png",
      size: 2048,
      contentLength: 2048,
    };

    const first = createPreviewAttachmentId(input);
    const second = createPreviewAttachmentId(input);

    expect(second).toBe(first);
    expect(pinned()).toEqual([first]);
  });

  it("drops the least recently minted pin once the cap is reached", () => {
    for (let index = 0; index < 512; index += 1) {
      pinPreviewAttachmentId(`preview_${index}`);
    }
    // Re-minting the oldest moves it to the back of the eviction order, so the
    // next mint evicts the one behind it instead.
    pinPreviewAttachmentId("preview_0");
    pinPreviewAttachmentId("preview_overflow");

    const ids = new Set(pinned());
    expect(ids.size).toBe(512);
    expect(ids.has("preview_overflow")).toBe(true);
    expect(ids.has("preview_0")).toBe(true);
    expect(ids.has("preview_1")).toBe(false);
  });
});
