import { open, lstat } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { AgentStorage, StoredAgentRecord } from "../../../agent/agent-storage.js";
import type { AgentTimelineRow } from "../../../agent/agent-timeline-store-types.js";
import { convertClaudeHistoryEntry } from "../../../agent/providers/claude/agent.js";
import { claudeProjectDir } from "../../../agent/providers/claude/project-dir.js";
import { normalizeProviderReplayTimestamp } from "../../../agent/provider-history-timestamps.js";
import type { OfflineHistoryReader } from "./backfill.js";
import { isSearchableRecord } from "./host.js";

const EPOCH = "1970-01-01T00:00:00.000Z";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_LINES = 100_000;
const offlineProviders = new Set(["claude", "pi", "omp"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fileStamp(info: {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
}

async function readStableJsonLines(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const named = await lstat(path);
  if (!named.isFile() || named.size < 1 || named.size > MAX_BYTES) return null;
  const file = await open(path, "r");
  try {
    const stamp = fileStamp(await file.stat());
    if (stamp !== fileStamp(named)) return null;
    const data = Buffer.alloc(named.size + 1);
    for (let offset = 0; offset < named.size; ) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(
        data,
        offset,
        Math.min(64 * 1024, data.length - offset),
        offset,
      );
      if (!bytesRead) return null;
      offset += bytesRead;
      if (offset > named.size) return null;
    }
    const entries: Record<string, unknown>[] = [];
    const lines = data.subarray(0, named.size).toString("utf8").split("\n");
    if (lines.length > MAX_LINES) return null;
    for (const [index, line] of lines.entries()) {
      if (index % 128 === 0) await setImmediate(undefined, { signal });
      if (!line.trim()) continue;
      const parsed = record(JSON.parse(line));
      if (!parsed) return null;
      entries.push(parsed);
    }
    signal.throwIfAborted();
    return stamp === fileStamp(await lstat(path)) ? entries : null;
  } finally {
    await file.close();
  }
}

function claudeRows(entries: Record<string, unknown>[]): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (const entry of entries) {
    if (entry.isSidechain || (entry.type !== "user" && entry.type !== "assistant")) continue;
    const message = record(entry.message);
    if (!message) continue;
    const items = convertClaudeHistoryEntry({ ...entry, message }, (content) => {
      if (entry.type !== "assistant") return [];
      if (typeof content === "string") return [{ type: "assistant_message", text: content }];
      return content.flatMap((block) =>
        block.type === "text" && typeof block.text === "string"
          ? [{ type: "assistant_message", text: block.text }]
          : [],
      );
    });
    for (const item of items) {
      if (item.type !== "user_message" && item.type !== "assistant_message") continue;
      rows.push({
        seq: rows.length + 1,
        item,
        timestamp: normalizeProviderReplayTimestamp(entry.timestamp) ?? EPOCH,
      });
    }
  }
  return rows;
}

function activeBranch(entries: readonly Record<string, unknown>[]) {
  const handled = entries.filter(
    (entry): entry is Record<string, unknown> & { id: string } =>
      entry.type !== "session" && typeof entry.id === "string",
  );
  const byId = new Map(handled.map((entry) => [entry.id, entry]));
  if (byId.size !== handled.length) return null;
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let current = handled.at(-1);
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    chain.push(current);
    if (current.parentId == null) break;
    if (typeof current.parentId !== "string") return null;
    current = byId.get(current.parentId);
    if (!current) return null;
  }
  return chain.toReversed();
}

function messageTextBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((value: unknown) => {
    const block = record(value);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  });
}

function unchangedRecord(before: StoredAgentRecord, after: StoredAgentRecord | null | undefined) {
  return (
    after &&
    isSearchableRecord(after) &&
    after.updatedAt === before.updatedAt &&
    after.cwd === before.cwd &&
    after.provider === before.provider &&
    after.persistence?.sessionId === before.persistence?.sessionId &&
    after.persistence?.nativeHandle === before.persistence?.nativeHandle
  );
}

function branchRows(entries: Record<string, unknown>[], sessionId: string) {
  if (entries[0]?.type !== "session" || entries[0]?.id !== sessionId) return null;
  const active = activeBranch(entries);
  if (!active) return null;
  const rows: AgentTimelineRow[] = [];
  for (const entry of active) {
    if (entry.type !== "message") continue;
    const message = record(entry.message);
    if (!message || (message.role !== "assistant" && message.role !== "user")) continue;
    const timestamp =
      normalizeProviderReplayTimestamp(entry.timestamp ?? message.timestamp) ?? EPOCH;
    const blocks = messageTextBlocks(message.content);

    const type = message.role === "user" ? "user_message" : "assistant_message";
    for (const text of type === "user_message" ? [blocks.join("\n\n")] : blocks) {
      if (text) rows.push({ seq: rows.length + 1, item: { type, text }, timestamp });
    }
  }
  return rows;
}

export function createOfflineHistoryReader(
  storage: Pick<AgentStorage, "get">,
): OfflineHistoryReader {
  return {
    supports: (provider) => offlineProviders.has(provider),
    async read(chat, signal) {
      const current = await storage.get(chat.id);
      if (!current || !isSearchableRecord(current) || current.provider !== chat.provider)
        return null;
      const handle = current.persistence;
      if (!handle || handle.provider !== chat.provider) return null;
      const path = await historyPath(
        current.cwd,
        handle.provider,
        handle.sessionId,
        handle.nativeHandle,
      );
      if (!path) return null;
      const entries = await readStableJsonLines(path, signal);
      if (!entries?.length) return null;
      const rows =
        handle.provider === "claude" ? claudeRows(entries) : branchRows(entries, handle.sessionId);
      const confirmed = await storage.get(chat.id);
      signal.throwIfAborted();
      if (!unchangedRecord(current, confirmed)) return null;

      return rows?.length ? rows : null;
    },
  };
}

async function historyPath(
  cwd: string,
  provider: string,
  sessionId: string,
  nativeHandle: unknown,
) {
  if (provider === "claude") {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return null;
    return join(await claudeProjectDir(cwd), `${sessionId}.jsonl`);
  }
  if (
    typeof nativeHandle !== "string" ||
    !isAbsolute(nativeHandle) ||
    extname(nativeHandle) !== ".jsonl"
  )
    return null;
  return nativeHandle;
}
