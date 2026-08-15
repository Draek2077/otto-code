import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeetingTranscriptStore } from "./transcript-store.js";

const roots: string[] = [];

async function createStore(): Promise<MeetingTranscriptStore> {
  const root = await mkdtemp(join(tmpdir(), "otto-meeting-transcripts-"));
  roots.push(root);
  return new MeetingTranscriptStore(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("MeetingTranscriptStore", () => {
  it("persists transcript-only records newest first", async () => {
    const store = await createStore();
    const earlier = await store.create({
      provider: "zoom",
      title: "Morning standup",
      content: "A transcript, without audio.",
      occurredAt: "2026-08-13T08:00:00.000Z",
    });
    const later = await store.create({
      provider: "zoom",
      title: "Afternoon review",
      content: "Another transcript.",
      occurredAt: "2026-08-13T14:00:00.000Z",
    });

    expect(await store.list()).toMatchObject([{ id: later.id }, { id: earlier.id }]);
    expect(await store.get(earlier.id)).toMatchObject({ content: "A transcript, without audio." });
  });

  it("edits or deletes one record without affecting the rest", async () => {
    const store = await createStore();
    const kept = await store.create({ provider: "zoom", title: "Keep", content: "Keep this." });
    const edited = await store.create({ provider: "zoom", title: "Before", content: "Before." });

    await expect(
      store.update(edited.id, { title: "After", content: "After." }),
    ).resolves.toMatchObject({
      title: "After",
      content: "After.",
    });
    await expect(store.delete(edited.id)).resolves.toBe(true);
    await expect(store.get(kept.id)).resolves.toMatchObject({ title: "Keep" });
    await expect(store.list()).resolves.toHaveLength(1);
  });
});
