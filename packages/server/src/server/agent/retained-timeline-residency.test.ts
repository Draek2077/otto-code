import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { AgentSnapshotPayload } from "../messages.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import {
  RetainedTimelineResidency,
  RETAINED_TRANSCRIPT_RESIDENCY_LIMIT,
} from "./retained-timeline-residency.js";
import { RetainedTranscriptStore } from "./retained-transcript-store.js";

const logger = createTestLogger();

describe("RetainedTimelineResidency", () => {
  test("evicts nothing while under the cap", () => {
    const residency = new RetainedTimelineResidency(3);
    expect([residency.retain("a"), residency.retain("b"), residency.retain("c")]).toEqual([
      [],
      [],
      [],
    ]);
    expect(residency.size).toBe(3);
  });

  test("evicts the least recently retained once the cap is exceeded", () => {
    const residency = new RetainedTimelineResidency(2);
    residency.retain("a");
    residency.retain("b");

    expect(residency.retain("c")).toEqual(["a"]);
    expect({ a: residency.has("a"), b: residency.has("b"), c: residency.has("c") }).toEqual({
      a: false,
      b: true,
      c: true,
    });
  });

  // Re-reading a transcript is what an open viewer does, so a re-retained id must
  // move to the back of the queue or the one being read is the one evicted.
  test("re-retaining refreshes recency instead of adding a duplicate", () => {
    const residency = new RetainedTimelineResidency(2);
    residency.retain("a");
    residency.retain("b");

    expect(residency.retain("a")).toEqual([]);
    expect(residency.size).toBe(2);
    expect(residency.retain("c")).toEqual(["b"]);
  });

  test("forget releases a slot without evicting anything", () => {
    const residency = new RetainedTimelineResidency(2);
    residency.retain("a");
    residency.retain("b");

    residency.forget("a");

    expect({
      has: residency.has("a"),
      size: residency.size,
      evicted: residency.retain("c"),
    }).toEqual({ has: false, size: 1, evicted: [] });
  });
});

describe("AgentManager retained transcript residency", () => {
  let dir: string;
  let store: RetainedTranscriptStore;
  let manager: AgentManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "otto-retained-residency-"));
    store = new RetainedTranscriptStore({ ottoHome: dir, logger });
    manager = new AgentManager({ clients: {}, logger, retainedTranscripts: store });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function saveTranscript(agentId: string): Promise<void> {
    const rows: AgentTimelineRow[] = [
      {
        seq: 1,
        timestamp: "2026-08-02T00:00:00.000Z",
        item: { type: "assistant_message", text: `run ${agentId}` },
      },
    ];
    await store.save({
      version: 1,
      agentId,
      owner: { kind: "schedule", id: "sched-1" },
      capturedAt: "2026-08-02T00:00:01.000Z",
      payload: { id: agentId, provider: "claude", cwd: dir } as AgentSnapshotPayload,
      rows,
      hasContent: true,
    });
  }

  // Nothing tells the daemon a viewer closed a retained transcript, so without the
  // cap every transcript ever opened keeps its full row set in the in-memory
  // timeline store for the daemon's lifetime.
  test("dropping the oldest retained transcript's rows once the cap is exceeded", async () => {
    const ids = Array.from(
      { length: RETAINED_TRANSCRIPT_RESIDENCY_LIMIT + 1 },
      (_unused, index) => `retained-${index}`,
    );
    for (const id of ids) {
      await saveTranscript(id);
      expect(await manager.ensureRetainedTranscriptLoaded(id)).toBe(true);
    }

    // The oldest lost its seeded rows: fetchTimeline no longer recognizes it as a
    // retained transcript and falls through to the unknown-agent path.
    expect(() => manager.fetchTimeline(ids[0])).toThrow();
    // The most recent is still served without a ManagedAgent.
    expect(manager.fetchTimeline(ids[ids.length - 1]).rows).toHaveLength(1);
  });

  test("an evicted transcript reloads from disk on the next open", async () => {
    const ids = Array.from(
      { length: RETAINED_TRANSCRIPT_RESIDENCY_LIMIT + 1 },
      (_unused, index) => `retained-${index}`,
    );
    for (const id of ids) {
      await saveTranscript(id);
      await manager.ensureRetainedTranscriptLoaded(id);
    }

    expect(await manager.ensureRetainedTranscriptLoaded(ids[0])).toBe(true);
    expect(manager.fetchTimeline(ids[0]).rows).toHaveLength(1);
  });

  // Reading a transcript counts as use, so the one the viewer is actually on is
  // never the one the cap throws out.
  test("a transcript being read stays resident while an idle one is evicted", async () => {
    const ids = Array.from(
      { length: RETAINED_TRANSCRIPT_RESIDENCY_LIMIT },
      (_unused, index) => `retained-${index}`,
    );
    for (const id of ids) {
      await saveTranscript(id);
      await manager.ensureRetainedTranscriptLoaded(id);
    }

    // Touch the oldest, then push one more in: the second-oldest goes instead.
    manager.fetchTimeline(ids[0]);
    await saveTranscript("retained-newcomer");
    await manager.ensureRetainedTranscriptLoaded("retained-newcomer");

    expect(manager.fetchTimeline(ids[0]).rows).toHaveLength(1);
    expect(() => manager.fetchTimeline(ids[1])).toThrow();
  });
});
