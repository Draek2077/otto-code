import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { StoredAgentRecord } from "../../../agent/agent-storage.js";
import { createOfflineHistoryReader } from "./offline-history.js";
import type { SearchChat } from "./types.js";

const chat: SearchChat = {
  id: "parent",
  title: "Old chat",
  provider: "pi",
  workspaceId: "workspace",
  projectId: "project",
  projectName: "Project",
  archived: true,
};
const timestamp = "2026-11-10T00:00:00.000Z";

async function withHistory(run: (path: string, stored: StoredAgentRecord) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "otto-offline-history-"));
  const path = join(home, "fixture.jsonl");
  const stored: StoredAgentRecord = {
    id: chat.id,
    provider: chat.provider,
    cwd: home,
    config: { provider: "pi", cwd: home },
    createdAt: timestamp,
    updatedAt: timestamp,
    labels: {},
    lastStatus: "closed",
    persistence: { provider: "pi", sessionId: "session-a", nativeHandle: path },
  };
  const entries = [
    { type: "session", id: "session-a" },
    {
      type: "message",
      id: "first",
      parentId: null,
      timestamp,
      message: { role: "user", content: "question" },
    },
    {
      type: "message",
      id: "abandoned",
      parentId: "first",
      timestamp,
      message: { role: "assistant", content: "discarded branch" },
    },
    {
      type: "message",
      id: "tool",
      parentId: "first",
      timestamp,
      message: { role: "toolResult", content: "private tool output" },
    },
    {
      type: "message",
      id: "current",
      parentId: "tool",
      timestamp,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "valid answer" },
          { type: "thinking", text: "private reasoning" },
        ],
      },
    },
  ];
  try {
    await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n"));
    await run(path, stored);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

it("recovers the active branch and indexes only conversation text", async () => {
  await withHistory(async (_path, stored) => {
    const get = vi.fn(async () => stored);
    const reader = createOfflineHistoryReader({ get });
    expect(reader.supports("pi")).toBe(true);
    expect(reader.supports("opencode")).toBe(false);
    const rows = await reader.read(chat, new AbortController().signal);
    expect(rows?.map((row) => row.item)).toEqual([
      { type: "user_message", text: "question" },
      { type: "assistant_message", text: "valid answer" },
    ]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

it("rejects another session's file and a changed record during recovery", async () => {
  await withHistory(async (path, stored) => {
    const wrong = {
      ...stored,
      persistence: { provider: "pi", sessionId: "session-b", nativeHandle: path },
    };
    const misplaced = createOfflineHistoryReader({ get: async () => wrong });
    expect(await misplaced.read(chat, new AbortController().signal)).toBeNull();
    const get = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ ...stored, updatedAt: "later" });
    const changed = createOfflineHistoryReader({ get });
    expect(await changed.read(chat, new AbortController().signal)).toBeNull();
  });
});
