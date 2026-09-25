/* eslint-disable unicorn/require-post-message-target-origin -- Node worker messages have no browser origin. */
import { parentPort, workerData } from "node:worker_threads";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { ChatSearchInput, ChatSearchResult, SearchChat, SearchSource } from "./types.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { projectSearchMessages } from "./messages.js";

interface Statement {
  run(...values: unknown[]): unknown;
  all(...values: unknown[]): Record<string, unknown>[];
  get(...values: unknown[]): Record<string, unknown> | undefined;
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (path: string) => Database;
}
const sourceSchema = z.object({
  version: z.literal(1),
  agentId: z.string(),
  revision: z.string(),
  complete: z.boolean(),
  providerRevision: z.string().optional(),
  verifiedAt: z.number().optional(),
  messages: z.array(
    z.object({
      key: z.string(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      timestamp: z.string(),
      sourceSeq: z.number(),
    }),
  ),
});
const directory = String(workerData.directory);
const sources = join(directory, "sources");
const indexPath = join(directory, "index.sqlite");
let database: Database | undefined;
let chats: SearchChat[] = [];
const revisions = new Map<string, string>();
const failures = new Set<string>();
const sourceMetadata = new Map<string, Omit<SearchSource, "messages">>();

function rememberSource(source: SearchSource): void {
  const { messages: _messages, ...metadata } = source;
  sourceMetadata.set(source.agentId, metadata);
}

function contentRevision(source: SearchSource): string {
  return createHash("sha256")
    .update(JSON.stringify({ complete: source.complete, messages: source.messages }))
    .digest("hex");
}

function isIndexCorruption(error: unknown): boolean {
  const code = (error as { errcode?: number }).errcode;
  return (
    (code !== undefined && [11, 26].includes(code & 255)) ||
    (error instanceof Error && error.message.includes("index integrity check"))
  );
}

function sourcePath(id: string): string {
  return join(sources, `${createHash("sha256").update(id).digest("hex")}.json`);
}

async function openDatabase(): Promise<Database> {
  await mkdir(sources, { recursive: true, mode: 0o700 });
  // @types/node@20 does not declare node:sqlite yet.
  const moduleName = "node:sqlite";
  const sqlite = (await import(moduleName)) as Sqlite;
  const db = new sqlite.DatabaseSync(indexPath);
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1)
      throw new Error("Chat search index integrity check failed: incompatible schema");
    db.exec("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=3000;");
    db.exec(`CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, revision TEXT NOT NULL, complete INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, agentId TEXT NOT NULL, messageKey TEXT NOT NULL, role TEXT NOT NULL, timestamp TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_agent ON messages(agentId);
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text, content='messages', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO search(rowid,text) VALUES(new.id,new.text); END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO search(search,rowid,text) VALUES('delete',old.id,old.text); END;
    INSERT INTO search(search,rank) VALUES('secure-delete',1);`);
    db.exec("PRAGMA user_version=1");
    const check = db.prepare("PRAGMA quick_check").get();
    if (check?.quick_check !== "ok") throw new Error("Chat search index integrity check failed");
    db.exec("INSERT INTO search(search,rank) VALUES('integrity-check',1)");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function ensureDatabase(): Promise<Database> {
  if (database) return database;
  try {
    database = await openDatabase();
  } catch (error) {
    // Only the derived index is discarded. Durable conversation sources remain untouched.
    if (!isIndexCorruption(error)) throw error;
    await rm(indexPath, { force: true });
    await rm(`${indexPath}-wal`, { force: true });
    await rm(`${indexPath}-shm`, { force: true });
    database = await openDatabase();
  }
  revisions.clear();
  return database;
}

function indexSource(db: Database, source: SearchSource): void {
  const indexed = db.prepare("SELECT revision FROM sources WHERE id=?").get(source.agentId);
  if (indexed?.revision === source.revision) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Stable keys let appends change only new messages; edits and rewinds remove old keys.
    const existing = new Map(
      db
        .prepare("SELECT id,messageKey,timestamp FROM messages WHERE agentId=?")
        .all(source.agentId)
        .map((row) => [String(row.messageKey), row]),
    );
    const keys = new Set(source.messages.map((message) => message.key));
    const remove = db.prepare("DELETE FROM messages WHERE id=?");
    for (const [key, row] of existing) if (!keys.has(key)) remove.run(row.id);
    const insert = db.prepare(
      "INSERT INTO messages(agentId,messageKey,role,timestamp,text) VALUES(?,?,?,?,?)",
    );
    const updateTimestamp = db.prepare("UPDATE messages SET timestamp=? WHERE id=?");
    for (const message of source.messages) {
      const previous = existing.get(message.key);
      if (!previous)
        insert.run(source.agentId, message.key, message.role, message.timestamp, message.text);
      else if (previous.timestamp !== message.timestamp)
        updateTimestamp.run(message.timestamp, previous.id);
    }
    db.prepare("INSERT OR REPLACE INTO sources VALUES(?,?,?)").run(
      source.agentId,
      source.revision,
      Number(source.complete),
    );
    db.exec("COMMIT");
    failures.delete(source.agentId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function reconcile(): Promise<void> {
  const db = await ensureDatabase();
  const eligible = new Set(chats.map((chat) => chat.id));
  for (const chat of chats) {
    try {
      const path = sourcePath(chat.id);
      const info = await stat(path);
      const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      if (revisions.get(chat.id) === stamp) continue;
      const source = sourceSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (source.agentId !== chat.id) throw new Error("Chat search source identity mismatch");
      if (source.revision !== contentRevision(source))
        throw new Error("Chat search source checksum mismatch");
      indexSource(db, source);
      rememberSource(source);
      revisions.set(chat.id, stamp);
      failures.delete(chat.id);
    } catch (error) {
      if (isIndexCorruption(error)) throw error;
      revisions.delete(chat.id);
      sourceMetadata.delete(chat.id);
      // Never return stale text when its source vanished or cannot be validated.
      db.prepare("DELETE FROM messages WHERE agentId=?").run(chat.id);
      db.prepare("DELETE FROM sources WHERE id=?").run(chat.id);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.add(chat.id);
    }
  }
  // A successful authoritative registry enumeration is supplied by the service. A failed
  // enumeration never reaches this operation and therefore cannot turn an outage into deletion.
  for (const row of db.prepare("SELECT id FROM sources").all()) {
    if (!eligible.has(String(row.id))) await removeSource(String(row.id));
  }
  const retainedFiles = new Set(chats.map((chat) => sourcePath(chat.id)));
  for (const file of await readdir(sources)) {
    if (/^[a-f0-9]{64}\.json$/.test(file) && !retainedFiles.has(join(sources, file)))
      await rm(join(sources, file), { force: true });
  }
}

async function saveSource(source: SearchSource): Promise<void> {
  await mkdir(sources, { recursive: true, mode: 0o700 });
  const revision = contentRevision(source);
  const path = sourcePath(source.agentId);
  const db = await ensureDatabase();
  // Source first, index second. A crash at either boundary is repaired by reconcile().
  const previous = db.prepare("SELECT revision FROM sources WHERE id=?").get(source.agentId);
  // Persist verification metadata even for unchanged text, without rewriting the FTS rows.
  if (
    previous?.revision !== revision ||
    source.providerRevision !== undefined ||
    source.verifiedAt !== undefined
  )
    await writeJsonFileAtomic(path, { ...source, revision });
  indexSource(db, { ...source, revision });
  rememberSource({ ...source, revision });
  revisions.delete(source.agentId);
}

async function removeSource(id: string): Promise<void> {
  const db = await ensureDatabase();
  await rm(sourcePath(id), { force: true });
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM messages WHERE agentId=?").run(id);
    db.prepare("DELETE FROM sources WHERE id=?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  revisions.delete(id);
  failures.delete(id);
  sourceMetadata.delete(id);
}

async function search(input: ChatSearchInput): Promise<ChatSearchResult> {
  const db = await ensureDatabase();
  const selected = chats.filter((chat) => {
    if (input.workspaceId && input.workspaceId !== chat.workspaceId) return false;
    if (input.projectId && input.projectId !== chat.projectId) return false;
    if (input.archive === "active") return !chat.archived;
    if (input.archive === "archived") return chat.archived;
    return true;
  });
  const byId = new Map(selected.map((chat) => [chat.id, chat]));
  const ready = new Set(
    db
      .prepare("SELECT id FROM sources WHERE complete=1")
      .all()
      .map((row) => String(row.id)),
  );
  const indexed = selected.filter((chat) => ready.has(chat.id) && !failures.has(chat.id)).length;
  const unavailable = selected.filter((chat) => failures.has(chat.id)).length;
  const coverage = {
    total: selected.length,
    indexed,
    unavailable,
    pending: selected.length - indexed - unavailable,
  };
  const tokens = input.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32) ?? [];
  if (!tokens.length || !selected.length) return { hits: [], coverage, hasMore: false };
  const expression = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
  // Temporary scope table avoids SQL variable limits for hosts with thousands of chats.
  db.exec("CREATE TEMP TABLE IF NOT EXISTS scope(id TEXT PRIMARY KEY); DELETE FROM scope;");
  const insert = db.prepare("INSERT INTO scope VALUES(?)");
  for (const chat of selected) if (!failures.has(chat.id)) insert.run(chat.id);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = db
    .prepare(`SELECT m.agentId,m.messageKey,m.role,m.timestamp,snippet(search,0,'','', '…',36) AS snippet
    FROM search JOIN messages m ON m.id=search.rowid JOIN scope s ON s.id=m.agentId
    WHERE search MATCH ? ORDER BY rank LIMIT ?`)
    .all(expression, limit + 1);
  return {
    coverage,
    hasMore: rows.length > limit,
    hits: rows.slice(0, limit).map((row) =>
      Object.assign({}, byId.get(String(row.agentId))!, {
        messageKey: String(row.messageKey),
        role: row.role as "user" | "assistant",
        timestamp: String(row.timestamp),
        snippet: String(row.snippet),
      }),
    ),
  };
}

type Request =
  | {
      id: number;
      type: "capture";
      agentId: string;
      rows: AgentTimelineRow[];
      complete: boolean;
      providerRevision?: string;
      verifiedAt: number;
    }
  | { id: number; type: "sync"; chats: SearchChat[] }
  | { id: number; type: "delete"; agentId: string }
  | { id: number; type: "search"; input: ChatSearchInput }
  | { id: number; type: "source"; agentId: string }
  | { id: number; type: "unavailable"; agentId: string }
  | { id: number; type: "close" };

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "capture":
      await saveSource({
        version: 1,
        agentId: request.agentId,
        revision: "",
        complete: request.complete,
        providerRevision: request.providerRevision,
        verifiedAt: request.verifiedAt,
        messages: projectSearchMessages(request.rows),
      });
      return null;
    case "sync":
      chats = request.chats;
      await reconcile();
      return null;
    case "delete":
      await removeSource(request.agentId);
      return null;
    case "search":
      return search(request.input);
    case "unavailable":
      failures.add(request.agentId);
      return null;
    case "source":
      return sourceMetadata.get(request.agentId) ?? null;
    case "close":
      database?.close();
      database = undefined;
      return null;
  }
}

// One owner serializes source commits, replacements, deletion and checkpoint advancement.
let tail = Promise.resolve();
parentPort!.on("message", (request: Request) => {
  tail = tail.then(async () => {
    try {
      let value: unknown;
      try {
        value = await handle(request);
      } catch (error) {
        if (!isIndexCorruption(error)) throw error;
        database?.close();
        database = undefined;
        await rm(indexPath, { force: true });
        await rm(`${indexPath}-wal`, { force: true });
        await rm(`${indexPath}-shm`, { force: true });
        await reconcile();
        value = await handle(request);
      }
      parentPort!.postMessage({ id: request.id, value });
    } catch (error) {
      parentPort!.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  });
});
