import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  clearAssistantImageMetadataCache,
  setAssistantImageMetadata,
} from "@/utils/assistant-image-metadata";
import {
  DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  estimateStreamItemHeight,
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
  shouldAbsorbVirtualRowResize,
  splitWebVirtualizedHistory,
  type IndexedStreamItem,
} from "./web-virtualization";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(id: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function toolCall(id: string, seed: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "test_tool",
        arguments: {},
        status: "completed",
      },
    },
  };
}

function thought(id: string, seed: number): StreamItem {
  return {
    kind: "thought",
    id,
    text: id,
    status: "ready",
    timestamp: createTimestamp(seed),
  };
}

function indexEntries(items: StreamItem[]): IndexedStreamItem[] {
  return items.map((item, index) => ({ item, index }));
}

describe("findMountedWindowStart", () => {
  it("keeps all items mounted when the chat is below the threshold", () => {
    const items = [userMessage("u1", 1), assistantMessage("a1", 2)];

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
      }),
    ).toBe(0);
  });

  it("rewinds to the previous user boundary when the cutoff lands inside a turn", () => {
    const items: StreamItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 3;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(toolCall(`t${index}`, seed + 2));
      items.push(assistantMessage(`a${index}`, seed + 3));
    }

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
      }),
    ).toBe(39);
  });

  it("holds the window open at a pin so a streaming turn cannot virtualize it", () => {
    const items: StreamItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 3;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(toolCall(`t${index}`, seed + 2));
      items.push(assistantMessage(`a${index}`, seed + 3));
    }

    // u10 sits at index 30, well above the natural boundary of 39. Pinning it
    // keeps everything from there on mounted: nothing the reader is looking at
    // gets swapped for a height estimate mid-turn.
    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
        pinnedStartItemId: "u10",
      }),
    ).toBe(30);
  });

  it("never lets a pin virtualize more than the natural window would", () => {
    const items: StreamItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 3;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(toolCall(`t${index}`, seed + 2));
      items.push(assistantMessage(`a${index}`, seed + 3));
    }

    // u20 sits at index 60, below the natural boundary. Honoring it would drop
    // mounted rows instead of holding them, so the natural boundary wins.
    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
        pinnedStartItemId: "u20",
      }),
    ).toBe(39);
  });

  it("keeps a long single turn fully mounted while following", () => {
    // One agentic run: a single user message, then 300 rows of tool calls and
    // replies with no user message anywhere in them. The walk-back is uncapped
    // on purpose: the boundary anchors on the message that opened the turn and
    // stays there for the whole stream. A capped walk used to advance the
    // boundary mid-turn, and each advance handed measured rows to the
    // virtualizer in a single frame - the document shrink whose clamp
    // spontaneously detached a reader who was just watching the stream. See
    // docs/chat-scrolling.md.
    const items: StreamItem[] = [userMessage("u0", 1)];
    for (let step = 0; step < 150; step += 1) {
      items.push(toolCall(`t${step}`, 2));
      items.push(assistantMessage(`a${step}`, 3));
    }
    expect(items).toHaveLength(301);

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 12,
      }),
    ).toBe(0);

    // Detached, the same boundary holds through the pin.
    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 12,
        pinnedStartItemId: "a149",
      }),
    ).toBe(0);
  });

  it("ignores a pin that has fallen out of the tail", () => {
    const items: StreamItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 3;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(toolCall(`t${index}`, seed + 2));
      items.push(assistantMessage(`a${index}`, seed + 3));
    }

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
        pinnedStartItemId: "evicted",
      }),
    ).toBe(39);
  });
});

describe("splitWebVirtualizedHistory", () => {
  it("splits older entries into the virtualized section and keeps the recent window mounted", () => {
    const items: StreamItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 2;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(assistantMessage(`a${index}`, seed + 2));
    }

    const window = splitWebVirtualizedHistory({
      entries: indexEntries(items),
      minMountedCount: 50,
    });

    expect(window.virtualizedEntries).toHaveLength(10);
    expect(window.virtualizedEntries[0]?.item.id).toBe("u0");
    expect(window.virtualizedEntries.at(-1)?.item.id).toBe("a4");
    expect(window.mountedEntries[0]?.item.id).toBe("u5");
    expect(window.mountedEntries).toHaveLength(50);
  });
});

describe("mounted window size at the shipped default", () => {
  // The rest of this file passes minMountedCount explicitly, so nothing here pins what a
  // real chat actually mounts. This does: the always-mounted tail is the floor cost of
  // scrolling a long chat, because those rows are fully rendered markdown no matter how
  // far up the reader has gone. The walk-back to a user boundary means the real number is
  // always a little above the setting, so the setting has to be read against a realistic
  // turn shape. 50 is upstream Paseo's number, restored deliberately - see the note on
  // DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS.
  it("mounts the last several turns of a long chat, not a fixed slab of it", () => {
    const items: StreamItem[] = [];
    for (let turn = 0; turn < 60; turn += 1) {
      const seed = turn % 60;
      items.push(userMessage(`u${turn}`, seed));
      for (let step = 0; step < 6; step += 1) {
        items.push(toolCall(`t${turn}-${step}`, seed));
      }
      items.push(assistantMessage(`a${turn}-0`, seed));
      items.push(assistantMessage(`a${turn}-1`, seed));
    }
    expect(items).toHaveLength(540);

    const window = splitWebVirtualizedHistory({
      entries: indexEntries(items),
      minMountedCount: getWebMountedRecentStreamItems(),
    });

    expect(window.mountedEntries).toHaveLength(54);
    expect(window.virtualizedEntries).toHaveLength(486);
    expect(
      window.mountedEntries.filter((entry) => entry.item.kind === "assistant_message"),
    ).toHaveLength(12);
    // The window always starts at a user message, so a turn is never split across the
    // virtualizer boundary mid-read.
    expect(window.mountedEntries[0]?.item.kind).toBe("user_message");
  });
});

describe("estimateStreamItemHeight", () => {
  it("uses compact estimates for collapsed tool sequence rows", () => {
    expect(estimateStreamItemHeight(toolCall("tool", 1))).toBe(40);
    expect(estimateStreamItemHeight(thought("thought", 2))).toBe(40);
  });

  it("uses a larger estimate for user messages with image attachments", () => {
    const item: StreamItem = {
      kind: "user_message",
      id: "u-image",
      text: "image",
      timestamp: createTimestamp(1),
      images: [
        {
          id: "att-1",
          mimeType: "image/png",
          storageType: "desktop-file",
          storageKey: "/tmp/screenshot.png",
          fileName: "screenshot.png",
          byteSize: 1024,
          createdAt: Date.now(),
        },
      ],
    };

    expect(estimateStreamItemHeight(item)).toBe(220);
  });

  it("uses cached assistant image metadata when available", () => {
    clearAssistantImageMetadataCache();
    setAssistantImageMetadata(
      {
        source: "https://example.com/tall.png",
      },
      { width: 800, height: 1600 },
    );

    const item: StreamItem = {
      kind: "assistant_message",
      id: "a-image",
      text: "Look at this\n\n![Screenshot](https://example.com/tall.png)",
      timestamp: createTimestamp(2),
    };

    expect(estimateStreamItemHeight(item)).toBeGreaterThan(220);
  });
});

describe("web virtualization test overrides", () => {
  it("uses defaults unless explicit positive integer overrides are present", () => {
    const globalWithOverrides = globalThis as typeof globalThis & {
      __OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
      __OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
    };
    const previousThreshold = globalWithOverrides.__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
    const previousMounted = globalWithOverrides.__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;

    try {
      delete globalWithOverrides.__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
      delete globalWithOverrides.__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;
      expect(getWebPartialVirtualizationThreshold()).toBe(
        DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
      );
      expect(getWebMountedRecentStreamItems()).toBe(DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS);

      globalWithOverrides.__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 6;
      globalWithOverrides.__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS = 4;
      expect(getWebPartialVirtualizationThreshold()).toBe(6);
      expect(getWebMountedRecentStreamItems()).toBe(4);
    } finally {
      if (previousThreshold === undefined) {
        delete globalWithOverrides.__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
      } else {
        globalWithOverrides.__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = previousThreshold;
      }
      if (previousMounted === undefined) {
        delete globalWithOverrides.__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;
      } else {
        globalWithOverrides.__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS = previousMounted;
      }
    }
  });
});

describe("shouldAbsorbVirtualRowResize", () => {
  // The block scrolled 900px past the top of the viewport, so a row 200px into
  // it sits above the fold and one 1000px in sits below it.
  const BLOCK_TOP_ABOVE_VIEWPORT = -900;

  it("absorbs a correction above the reader", () => {
    expect(
      shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: BLOCK_TOP_ABOVE_VIEWPORT,
        rowStart: 200,
      }),
    ).toBe(true);
  });

  // The regression: a row measured below the fold used to move scrollTop too,
  // so every upward gesture was partly cancelled by growth the reader cannot
  // see and the transcript stalled short of its first message.
  it("leaves the reader alone when the resized row is below the viewport", () => {
    expect(
      shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: BLOCK_TOP_ABOVE_VIEWPORT,
        rowStart: 1000,
      }),
    ).toBe(false);
  });

  it("treats a row starting exactly at the top edge as below it", () => {
    expect(
      shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: BLOCK_TOP_ABOVE_VIEWPORT,
        rowStart: 900,
      }),
    ).toBe(false);
  });

  // The answer does not depend on follow/detach, and that is the fix rather than
  // an oversight. This used to return false for every row whenever the app was
  // following, which is the state a send puts it in: releasing the mounted-window
  // pin hands a turn back to the virtualizer at estimated heights, and the
  // re-measurement that follows grows the document above the viewport by
  // thousands of pixels with nothing subtracting it back off. See the note on
  // shouldAbsorbVirtualRowResize.
  it("absorbs growth above the reader in the following state too", () => {
    expect(
      shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: BLOCK_TOP_ABOVE_VIEWPORT,
        rowStart: 200,
      }),
    ).toBe(true);
  });

  // At the very top of the transcript nothing is above the reader at all, which
  // is exactly where the stall was reported.
  it("absorbs nothing once the block starts inside the viewport", () => {
    expect(
      shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: 16,
        rowStart: 0,
      }),
    ).toBe(false);
  });
});

describe("scrolling up past never-measured history", () => {
  // The wall the reader hits, in the shape that produces it. Estimates for
  // history nobody has scrolled through undershoot badly - an assistant reply
  // nobody has mounted is guessed at 220px, a tool row at 40 - so each row the
  // virtualizer measures on the way up reports a large positive delta. With
  // overscan 8 that is thousands of pixels per batch, far more than a wheel
  // tick, and any of it applied for rows BELOW the fold pushes the reader back
  // down harder than they can scroll up. The reachable range collapses to the
  // part of the transcript that was already measured.
  const UNDERSHOOT_PER_ROW = 160;
  const OVERSCAN_ROWS = 8;
  const VIEWPORT_TOP_IN_BLOCK = 900;

  function totalScrollAdjustment(rowStarts: number[]): number {
    return rowStarts.reduce((total, rowStart) => {
      const absorbs = shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: -VIEWPORT_TOP_IN_BLOCK,
        rowStart,
      });
      return absorbs ? total + UNDERSHOOT_PER_ROW : total;
    }, 0);
  }

  it("does not move the reader for a batch measured below the fold", () => {
    const belowFold = Array.from(
      { length: OVERSCAN_ROWS },
      (_, index) => VIEWPORT_TOP_IN_BLOCK + index * 200,
    );

    expect(totalScrollAdjustment(belowFold)).toBe(0);
  });

  it("still absorbs a batch measured above the reader, which is what holds the view still", () => {
    const aboveFold = Array.from({ length: OVERSCAN_ROWS }, (_, index) => index * 100);

    expect(totalScrollAdjustment(aboveFold)).toBe(OVERSCAN_ROWS * UNDERSHOOT_PER_ROW);
  });
});

describe("sending after reading back through history", () => {
  // The reported bug, in the shape that produces it: send (or queue) a message
  // after scrolling up, and the transcript lands at the very top instead of the
  // bottom.
  //
  // Sending asks for the bottom, which drops the mounted-window pin, which hands
  // the whole read-back turn to the virtualizer at estimated heights in one
  // commit. The virtualizer then re-measures those rows in overscan-sized
  // batches, and every one of them is above the viewport. Their real heights
  // dwarf the estimates, so the document grows underneath the request that was
  // supposed to end at the end of it.
  //
  // The stick-to-bottom rAF cannot win that race on its own: it fires once per
  // frame against whatever the document is at that instant, while the batches
  // keep landing. Absorbing the growth is what makes the position converge, and
  // it costs nothing, because the stick writes an absolute scrollTop over the
  // top of it.
  const BATCHES = 6;
  const ROWS_PER_BATCH = 8;
  const UNDERSHOOT_PER_ROW = 580;
  const VIEWPORT_TOP_IN_BLOCK = 12_000;

  function driftFromBottomAfterRegrow(): number {
    let unabsorbedGrowth = 0;
    for (let batch = 0; batch < BATCHES; batch += 1) {
      for (let row = 0; row < ROWS_PER_BATCH; row += 1) {
        const rowStart = batch * ROWS_PER_BATCH * 220 + row * 220;
        const absorbs = shouldAbsorbVirtualRowResize({
          blockViewportRelativeTop: -VIEWPORT_TOP_IN_BLOCK,
          rowStart,
        });
        if (!absorbs) {
          unabsorbedGrowth += UNDERSHOOT_PER_ROW;
        }
      }
    }
    return unabsorbedGrowth;
  }

  it("leaves the view at the bottom once the virtualizer has re-measured the turn", () => {
    // Every re-measured row sits above the viewport, so nothing is left over to
    // push the reader up. Before the fix this was 48 rows x 580px of shove.
    expect(driftFromBottomAfterRegrow()).toBe(0);
  });
});
