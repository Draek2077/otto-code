import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMeetingTranscriptStore } from "./local-meeting-transcript-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeStore(): Promise<LocalMeetingTranscriptStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-meeting-transcripts-"));
  roots.push(root);
  return new LocalMeetingTranscriptStore(root);
}

describe("LocalMeetingTranscriptStore", () => {
  it("retains text records locally and orders them newest first", async () => {
    const store = await makeStore();
    const older = await store.create({
      provider: "zoom",
      title: "Older meeting",
      content: "Older transcript",
      occurredAt: "2026-08-13T10:00:00.000Z",
      deliveryState: "local_only",
    });
    const newer = await store.create({
      provider: "zoom",
      title: "Newer meeting",
      content: "Newer transcript",
      occurredAt: "2026-08-13T11:00:00.000Z",
      deliveryState: "waiting_for_secure_connection",
    });

    await expect(store.list()).resolves.toEqual([newer, older]);
  });

  it("edits and deletes a locally retained transcript", async () => {
    const store = await makeStore();
    const record = await store.create({
      provider: "zoom",
      title: "Meeting notes",
      content: "Original transcript",
      occurredAt: "2026-08-13T10:00:00.000Z",
      deliveryState: "local_only",
    });

    const updated = await store.update({
      id: record.id,
      title: "Renamed notes",
      content: "Edited transcript",
    });
    expect(updated).toMatchObject({ title: "Renamed notes", content: "Edited transcript" });
    await expect(store.delete(record.id)).resolves.toBe(true);
    await expect(store.list()).resolves.toEqual([]);
  });
});
