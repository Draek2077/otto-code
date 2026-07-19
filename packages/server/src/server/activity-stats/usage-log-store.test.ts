import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageEvent } from "@otto-code/protocol/messages";
import { UsageLogStore } from "./usage-log-store.js";

function evt(id: string, at: number, over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id,
    at,
    kind: "chat",
    provider: "claude",
    tokensIn: 100,
    tokensOut: 10,
    costMicroUsd: 0,
    ...over,
  };
}

describe("UsageLogStore", () => {
  let dir: string;
  let filePath: string;
  const now = Date.now();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "usage-log-"));
    filePath = join(dir, "usage-log.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty page when no file exists", async () => {
    const store = new UsageLogStore(filePath);
    const page = await store.getPage();
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("returns appended rows newest-first", async () => {
    const store = new UsageLogStore(filePath);
    await store.append(evt("a", now - 2000));
    await store.append(evt("b", now - 1000));
    await store.append(evt("c", now));

    const page = await store.getPage();
    expect(page.events.map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(page.hasMore).toBe(false);
  });

  it("paginates with limit + before cursor", async () => {
    const store = new UsageLogStore(filePath);
    for (let i = 0; i < 5; i++) {
      await store.append(evt(`e${i}`, now - (5 - i) * 1000));
    }

    const first = await store.getPage({ limit: 2 });
    expect(first.events.map((e) => e.id)).toEqual(["e4", "e3"]);
    expect(first.hasMore).toBe(true);

    const oldestSoFar = first.events[first.events.length - 1]!.at;
    const second = await store.getPage({ limit: 2, before: oldestSoFar });
    expect(second.events.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(second.hasMore).toBe(true);
  });

  it("drops rows older than the age window on append", async () => {
    const store = new UsageLogStore(filePath);
    const fortyDaysMs = 40 * 24 * 60 * 60 * 1000;
    await store.append(evt("old", now - fortyDaysMs));
    await store.append(evt("fresh", now));

    const page = await store.getPage();
    expect(page.events.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("keeps every row within the 30-day window (no row cap)", async () => {
    const store = new UsageLogStore(filePath);
    const count = 6000;
    for (let i = 0; i < count; i++) {
      // All well within 30 days — spread over the last day.
      await store.append(evt(`e${i}`, now - (count - i) * 1000));
    }
    // Page back through all of them; nothing is dropped for being numerous.
    const ids = new Set<string>();
    let cursor: number | undefined = undefined;
    for (let guard = 0; guard < 100; guard++) {
      const p: Awaited<ReturnType<UsageLogStore["getPage"]>> = await store.getPage({
        limit: 500,
        before: cursor,
      });
      if (p.events.length === 0) break;
      for (const e of p.events) ids.add(e.id);
      if (!p.hasMore) break;
      cursor = p.events[p.events.length - 1]!.at;
    }
    expect(ids.size).toBe(count);
    expect(ids.has("e0")).toBe(true);
  });

  it("persists across store instances after flush", async () => {
    const first = new UsageLogStore(filePath);
    await first.append(evt("x", now, { model: "claude-sonnet-5", costMicroUsd: 140000 }));
    await first.flush();

    const second = new UsageLogStore(filePath);
    const page = await second.getPage();
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.id).toBe("x");
    expect(page.events[0]!.model).toBe("claude-sonnet-5");
    expect(page.events[0]!.costMicroUsd).toBe(140000);
  });

  it("reset drops every row and persists the empty log immediately", async () => {
    const store = new UsageLogStore(filePath);
    await store.append(evt("a", now - 1000));
    await store.append(evt("b", now));

    await store.reset();

    // No flush needed — reset writes synchronously.
    const page = await store.getPage();
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);

    // The wipe survives a fresh store reading the file.
    const reloaded = new UsageLogStore(filePath);
    const reloadedPage = await reloaded.getPage();
    expect(reloadedPage.events).toEqual([]);
  });

  it("preserves the round count across reload", async () => {
    const first = new UsageLogStore(filePath);
    // A sub-agent row covering 10 model round-trips.
    await first.append(evt("sub", now, { kind: "subagent", rounds: 10 }));
    await first.flush();

    const second = new UsageLogStore(filePath);
    const page = await second.getPage();
    expect(page.events[0]!.rounds).toBe(10);
  });

  it("preserves the cache-read split across reload", async () => {
    const first = new UsageLogStore(filePath);
    // A Claude turn: 127k "in" of which 119k is cache-read (fresh = 8k).
    await first.append(evt("cached", now, { tokensIn: 127000, cachedTokensIn: 119000 }));
    await first.flush();

    const second = new UsageLogStore(filePath);
    const page = await second.getPage();
    expect(page.events[0]!.tokensIn).toBe(127000);
    expect(page.events[0]!.cachedTokensIn).toBe(119000);
  });
});
