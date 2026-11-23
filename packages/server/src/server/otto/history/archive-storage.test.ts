import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentStorage, parseStoredAgentRecord } from "../../agent/agent-storage.js";

async function fixture(
  run: (input: {
    directory: string;
    storage: AgentStorage;
    transcript: string;
    agentId: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "otto-reviewed-archive-"));
  try {
    const home = join(directory, "records");
    await mkdir(home);
    const storage = new AgentStorage(home, createTestLogger());
    const transcript = join(directory, "provider-transcript.jsonl");
    await writeFile(transcript, "provider-owned evidence");
    const agentId = "archived-agent";
    const now = "2026-11-10T08:00:00.000Z";
    await storage.upsert(
      parseStoredAgentRecord({
        id: agentId,
        provider: "mock",
        cwd: directory,
        title: "Old chat",
        createdAt: now,
        updatedAt: now,
        archivedAt: now,
        persistence: { provider: "mock", sessionId: "persistent-chat", nativeHandle: transcript },
      }),
    );
    await storage.flush();
    await run({ directory: home, storage, transcript, agentId });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function recordPath(directory: string, agentId: string): Promise<string> {
  const files = await readdir(directory, { recursive: true });
  const match = files.find((file) => file.endsWith(`${agentId}.json`));
  if (!match) throw new Error("Expected the archived record file");
  return join(directory, match);
}

test("clears the reviewed Otto record and preserves provider transcripts", async () => {
  await fixture(async ({ directory, storage, transcript, agentId }) => {
    const review = await storage.inspectReviewedArchive(agentId);
    if (!review) throw new Error("Expected the archived record");
    const file = await recordPath(directory, agentId);
    expect(review.bytes).toBe((await readFile(file)).byteLength);
    expect(await storage.removeReviewedArchive(review)).toEqual({
      status: "deleted",
      bytes: review.bytes,
    });
    expect(await storage.get(agentId)).toBeNull();
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(transcript, "utf8")).toBe("provider-owned evidence");
  });
});

test("restoring an archived chat invalidates the existing review and leaves its new record", async () => {
  await fixture(async ({ storage, agentId }) => {
    const review = await storage.inspectReviewedArchive(agentId);
    const existing = await storage.get(agentId);
    if (!review || !existing) throw new Error("Expected the archived record");
    await storage.upsert({ ...existing, archivedAt: null, updatedAt: "2026-11-10T09:00:00Z" });
    expect(await storage.removeReviewedArchive(review)).toEqual({ status: "changed" });
    expect(await storage.get(agentId)).toMatchObject({ archivedAt: null });
    expect(await storage.inspectReviewedArchive(agentId)).toBeNull();
  });
});

test("detects an external edit after review even when the record timestamp stays the same", async () => {
  await fixture(async ({ directory, storage, agentId }) => {
    const review = await storage.inspectReviewedArchive(agentId);
    if (!review) throw new Error("Expected the archived record");
    const record = await recordPath(directory, agentId);
    const body = (await readFile(record, "utf8")).replace("Old chat", "New chat");
    await writeFile(record, body);
    expect(await storage.removeReviewedArchive(review)).toEqual({ status: "changed" });
    expect(await readFile(record, "utf8")).toBe(body);
  });
});
