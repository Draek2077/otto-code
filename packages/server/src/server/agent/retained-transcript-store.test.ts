import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pino } from "pino";
import type { AgentSnapshotPayload } from "../messages.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import {
  RetainedTranscriptStore,
  type RetainedTranscriptOwner,
  type RetainedTranscriptRecord,
} from "./retained-transcript-store.js";

const logger = pino({ level: "silent" });

function buildRecord(
  agentId: string,
  owner: RetainedTranscriptOwner,
  overrides?: Partial<RetainedTranscriptRecord>,
): RetainedTranscriptRecord {
  const rows: AgentTimelineRow[] = [
    { seq: 1, timestamp: "2026-07-18T00:00:00.000Z", item: { type: "user_message", text: "hi" } },
    {
      seq: 2,
      timestamp: "2026-07-18T00:00:01.000Z",
      item: { type: "assistant_message", text: "hello" },
    },
  ];
  return {
    version: 1,
    agentId,
    owner,
    capturedAt: "2026-07-18T00:00:02.000Z",
    payload: { id: agentId, provider: "claude", cwd: "/tmp" } as AgentSnapshotPayload,
    rows,
    hasContent: true,
    ...overrides,
  };
}

describe("RetainedTranscriptStore", () => {
  let dir: string;
  let store: RetainedTranscriptStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "otto-retained-"));
    store = new RetainedTranscriptStore({ ottoHome: dir, logger });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("saves and reads back a record verbatim", async () => {
    const record = buildRecord("agent-1", { kind: "artifact", id: "art-1" });
    await store.save(record);
    expect(await store.get("agent-1")).toEqual(record);
  });

  test("get survives a fresh store instance (persisted to disk, not just cached)", async () => {
    await store.save(buildRecord("agent-1", { kind: "schedule", id: "sched-1" }));
    const reopened = new RetainedTranscriptStore({ ottoHome: dir, logger });
    const loaded = await reopened.get("agent-1");
    expect(loaded?.agentId).toBe("agent-1");
    expect(loaded?.rows).toHaveLength(2);
  });

  test("get returns null for an unknown id", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  test("delete removes the record", async () => {
    await store.save(buildRecord("agent-1", { kind: "artifact", id: "art-1" }));
    await store.delete("agent-1");
    expect(await store.get("agent-1")).toBeNull();
  });

  test("deleteForOwner removes only that owner's transcripts", async () => {
    await store.save(buildRecord("a1", { kind: "artifact", id: "art-1" }));
    await store.save(buildRecord("a2", { kind: "artifact", id: "art-1" }));
    await store.save(buildRecord("a3", { kind: "artifact", id: "art-2" }));
    await store.save(buildRecord("s1", { kind: "schedule", id: "art-1" }));

    const removed = await store.deleteForOwner({ kind: "artifact", id: "art-1" });

    expect(removed).toBe(2);
    expect(await store.get("a1")).toBeNull();
    expect(await store.get("a2")).toBeNull();
    // Same id but different kind, and a different artifact id, are untouched.
    expect(await store.get("s1")).not.toBeNull();
    expect(await store.get("a3")).not.toBeNull();
  });

  test("rejects a path-traversing agent id on save", async () => {
    const record = buildRecord("../escape", { kind: "artifact", id: "art-1" });
    await expect(store.save(record)).rejects.toThrow(/Invalid retained-transcript agent id/);
  });

  test("get on a malformed id returns null instead of throwing", async () => {
    expect(await store.get("../escape")).toBeNull();
  });
});
