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

function assistantBlock(groupId: string, blockIndex: number, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id: `${groupId}:block:${blockIndex}`,
    text: `block ${blockIndex}`,
    timestamp: createTimestamp(seed),
    blockGroupId: groupId,
    blockIndex,
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

  it("gives up the walk-back on a long single turn while following, but not while pinned", () => {
    // One agentic run: a single user message, then 300 rows of tool calls and
    // replies with no user message anywhere in them. Uncapped, the walk anchors
    // on the line that opened the turn and the entire turn stays mounted for as
    // long as it streams, which voids the tail cap exactly when it matters.
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
    ).toBe(289);

    // Detached, the contract is unchanged: the boundary the reader was looking
    // at holds, whatever it costs. See docs/chat-scrolling.md.
    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 12,
        pinnedStartItemId: "a149",
      }),
    ).toBe(0);
  });

  it("settles on a bubble group's first block rather than cutting the bubble in half", () => {
    // The tail lands mid-way through a 20-block reply. Blocks sharing a
    // blockGroupId butt together into one visible bubble, so the only place to
    // cut is the block that starts it.
    const items: StreamItem[] = [userMessage("u0", 1)];
    for (let step = 0; step < 60; step += 1) {
      items.push(toolCall(`t${step}`, 2));
    }
    for (let block = 0; block < 20; block += 1) {
      items.push(assistantBlock("g", block, 3));
    }
    expect(items).toHaveLength(81);

    const start = findMountedWindowStart({ items, minMountedCount: 12 });

    expect(start).toBe(61);
    expect(items[start]?.id).toBe("g:block:0");
  });

  it("still rewinds to a user message that sits within the cap", () => {
    // 29 rows back is an ordinary conversational turn, which is the shape the
    // walk-back exists for — the closer tool-call boundaries must not win.
    const items: StreamItem[] = [userMessage("u0", 1)];
    for (let step = 0; step < 40; step += 1) {
      items.push(toolCall(`t${step}`, 2));
    }

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 12,
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
  // far up the reader has gone. At the old default of 50 this chat mounted 54 rows and 12
  // assistant bubbles; the walk-back to a user boundary means the real number is always a
  // little above the setting, so the setting has to be read against a realistic turn shape.
  it("mounts roughly one recent turn of a long chat, not a fixed slab of it", () => {
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

    expect(window.mountedEntries).toHaveLength(18);
    expect(window.virtualizedEntries).toHaveLength(522);
    expect(
      window.mountedEntries.filter((entry) => entry.item.kind === "assistant_message"),
    ).toHaveLength(4);
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
