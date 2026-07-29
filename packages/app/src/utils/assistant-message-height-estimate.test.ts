import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAssistantMessageHeightEstimateCache,
  estimateAssistantMessageHeightFromCache,
  hasAssistantMarkdownBlockHeight,
  setAssistantMarkdownBlockHeight,
} from "./assistant-message-height-estimate";
import {
  clearAssistantImageMetadataCache,
  setAssistantImageMetadata,
} from "./assistant-image-metadata";

describe("assistant message height estimate", () => {
  beforeEach(() => {
    clearAssistantMessageHeightEstimateCache();
    clearAssistantImageMetadataCache();
  });

  it("estimates assistant message height from measured markdown block heights", () => {
    setAssistantMarkdownBlockHeight({
      block: "First paragraph",
      width: 804,
      height: 18.2,
    });
    setAssistantMarkdownBlockHeight({
      block: "Second paragraph",
      width: 804,
      height: 41.1,
    });

    // 24 vertical padding + ceil(18.2) + ceil(41.1); measured heights already
    // include each block's own trailing markdown margin, so no per-block gap.
    expect(estimateAssistantMessageHeightFromCache("First paragraph\n\nSecond paragraph")).toBe(85);
  });

  // Regression: reads used to be pinned to `MAX_CONTENT_WIDTH - 16` while writes used the
  // block's real rendered width, so the cache only ever hit when the chat column happened to
  // be exactly that wide. Everywhere else the estimator returned null and the per-block
  // measurement feeding it was wasted work.
  it("estimates from blocks measured at any column width, not just the fallback width", () => {
    setAssistantMarkdownBlockHeight({ block: "First paragraph", width: 517, height: 20 });
    setAssistantMarkdownBlockHeight({ block: "Second paragraph", width: 517, height: 30 });

    expect(estimateAssistantMessageHeightFromCache("First paragraph\n\nSecond paragraph")).toBe(74);
  });

  it("reports whether a block is already measured at a given width", () => {
    setAssistantMarkdownBlockHeight({ block: "First paragraph", width: 517, height: 20 });

    expect(hasAssistantMarkdownBlockHeight({ block: "First paragraph", width: 517 })).toBe(true);
    // A resize has to re-arm measurement, so a different width is a miss.
    expect(hasAssistantMarkdownBlockHeight({ block: "First paragraph", width: 640 })).toBe(false);
    expect(hasAssistantMarkdownBlockHeight({ block: "Unseen paragraph", width: 517 })).toBe(false);
  });

  it("falls back to image metadata when markdown blocks are not measured", () => {
    setAssistantImageMetadata(
      {
        source: "https://example.com/landscape.png",
      },
      { width: 1200, height: 800 },
    );

    expect(
      estimateAssistantMessageHeightFromCache(
        "Here is the screenshot\n\n![Screenshot](https://example.com/landscape.png)",
      ),
    ).toBeGreaterThan(220);
  });
});
