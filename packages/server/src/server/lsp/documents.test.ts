import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { LspConnection } from "./connection.js";
import { LspDocuments } from "./documents.js";
import { LspServerPool } from "./pool.js";
import type { LspServerRow } from "./registry.js";

const stubServer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures",
  "stub-language-server.mjs",
);
const logger = pino({ level: "silent" });

interface ReceivedNotification {
  kind: "didOpen" | "didChange" | "didClose";
  uri: string;
  version?: number;
  languageId?: string;
  text?: string;
}

const tempRoots: string[] = [];
const pools: LspServerPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.stopAll()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-lsp-docs-"));
  tempRoots.push(dir);
  return dir;
}

function stubRow(id: string, extensions: readonly string[] = [".ts"]): LspServerRow {
  return {
    id,
    languageIds: ["plaintext"],
    extensions,
    bin: "node",
    args: [stubServer, "normal"],
    discovery: ["path"],
    defaultEnabled: true,
    indexCost: "none",
  };
}

function createDocuments(rows: readonly LspServerRow[]): LspDocuments {
  const pool = new LspServerPool({
    rows,
    logger,
    limits: {
      maxRunningServers: 8,
      idleMs: 600_000,
      backgroundIdleMs: 120_000,
      crashBackoffMs: 1000,
      maxCrashBackoffMs: 30_000,
      initializeTimeoutMs: 15_000,
      requestTimeoutMs: 5000,
    },
    now: () => 0,
  });
  pools.push(pool);
  return new LspDocuments({ pool, logger });
}

function received(connection: LspConnection): Promise<ReceivedNotification[]> {
  return connection.request<ReceivedNotification[]>("stub/received", null);
}

describe("opening a document", () => {
  it("sends didOpen the first time a server is asked about a file", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "const a = 1;\n" });
    const bound = await documents.serversFor(rootPath, filePath);

    expect(bound).toHaveLength(1);
    expect(await received(bound[0].connection)).toEqual([
      {
        kind: "didOpen",
        uri: expect.stringContaining("a.ts"),
        version: 1,
        languageId: "typescript",
        text: "const a = 1;\n",
      },
    ]);
  });

  it("announces a .tsx file as typescriptreact", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub", [".tsx"])]);
    const filePath = path.join(rootPath, "a.tsx");

    await documents.sync({ rootPath, filePath, text: "export const A = () => null;\n" });
    const bound = await documents.serversFor(rootPath, filePath);

    const notifications = await received(bound[0].connection);
    expect(notifications[0].languageId).toBe("typescriptreact");
  });

  it("opens the document in every server bound to it", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("tsish"), stubRow("angularish")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "const a = 1;\n" });
    const bound = await documents.serversFor(rootPath, filePath);

    expect(bound).toHaveLength(2);
    for (const server of bound) {
      const notifications = await received(server.connection);
      expect(notifications.map((entry) => entry.kind)).toEqual(["didOpen"]);
    }
  });

  it("opens with the current text in a server that starts after the edits", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "first\n" });
    await documents.sync({ rootPath, filePath, text: "second\n" });
    const bound = await documents.serversFor(rootPath, filePath);

    // The server was spawned lazily, well after both edits: it must be handed the
    // latest text as a didOpen, never replayed a didChange it has no baseline for.
    expect(await received(bound[0].connection)).toEqual([
      {
        kind: "didOpen",
        uri: expect.stringContaining("a.ts"),
        version: 2,
        languageId: "typescript",
        text: "second\n",
      },
    ]);
  });
});

describe("changing a document", () => {
  it("sends didChange with an incrementing version to an already-open server", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "one\n" });
    const bound = await documents.serversFor(rootPath, filePath);
    await documents.sync({ rootPath, filePath, text: "two\n" });
    await documents.sync({ rootPath, filePath, text: "three\n" });

    expect(await received(bound[0].connection)).toEqual([
      expect.objectContaining({ kind: "didOpen", version: 1, text: "one\n" }),
      expect.objectContaining({ kind: "didChange", version: 2, text: "two\n" }),
      expect.objectContaining({ kind: "didChange", version: 3, text: "three\n" }),
    ]);
  });

  it("ignores a sync that does not change the text, since the client debounces", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "same\n" });
    const bound = await documents.serversFor(rootPath, filePath);
    await documents.sync({ rootPath, filePath, text: "same\n" });
    await documents.sync({ rootPath, filePath, text: "same\n" });

    const notifications = await received(bound[0].connection);
    expect(notifications.map((entry) => entry.kind)).toEqual(["didOpen"]);
  });

  it("keeps versions per document rather than globally", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const first = path.join(rootPath, "a.ts");
    const second = path.join(rootPath, "b.ts");

    await documents.sync({ rootPath, filePath: first, text: "a1\n" });
    await documents.sync({ rootPath, filePath: second, text: "b1\n" });
    const bound = await documents.serversFor(rootPath, second);

    const notifications = await received(bound[0].connection);
    expect(notifications).toEqual([
      expect.objectContaining({ uri: expect.stringContaining("b.ts"), version: 1 }),
    ]);
  });
});

describe("closing a document", () => {
  it("sends didClose to the servers that had it open", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "one\n" });
    const bound = await documents.serversFor(rootPath, filePath);
    await documents.close({ rootPath, filePath });

    const notifications = await received(bound[0].connection);
    expect(notifications.map((entry) => entry.kind)).toEqual(["didOpen", "didClose"]);
  });

  it("re-opens from scratch at version 1 after a close", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await documents.sync({ rootPath, filePath, text: "one\n" });
    await documents.serversFor(rootPath, filePath);
    await documents.close({ rootPath, filePath });

    await documents.sync({ rootPath, filePath, text: "again\n" });
    const bound = await documents.serversFor(rootPath, filePath);

    const notifications = await received(bound[0].connection);
    expect(notifications.at(-1)).toEqual(
      expect.objectContaining({ kind: "didOpen", version: 1, text: "again\n" }),
    );
  });

  it("closing an unknown document is not an error", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);

    await expect(
      documents.close({ rootPath, filePath: path.join(rootPath, "never-opened.ts") }),
    ).resolves.toBeUndefined();
  });

  it("closes every document in a workspace at once", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const first = path.join(rootPath, "a.ts");
    const second = path.join(rootPath, "b.ts");

    await documents.sync({ rootPath, filePath: first, text: "a\n" });
    await documents.sync({ rootPath, filePath: second, text: "b\n" });
    await documents.serversFor(rootPath, first);
    await documents.serversFor(rootPath, second);

    await documents.closeWorkspace(rootPath);

    expect(documents.openCount()).toBe(0);
  });
});

describe("querying a file no editor is mirroring", () => {
  it("opens it from disk so the server can answer about it", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, "const onDisk = 1;\n", "utf8");

    // No sync: this is a References tab restored after a client reload, whose file has
    // no mounted editor tab to mirror the buffer.
    const bound = await documents.serversFor(rootPath, filePath);

    expect(await received(bound[0].connection)).toEqual([
      {
        kind: "didOpen",
        uri: expect.stringContaining("a.ts"),
        version: 1,
        languageId: "typescript",
        text: "const onDisk = 1;\n",
      },
    ]);
  });

  it("re-asking does not re-open it", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, "const onDisk = 1;\n", "utf8");

    const bound = await documents.serversFor(rootPath, filePath);
    await documents.serversFor(rootPath, filePath);
    await documents.serversFor(rootPath, filePath);

    const notifications = await received(bound[0].connection);
    expect(notifications.map((entry) => entry.kind)).toEqual(["didOpen"]);
  });

  it("an editor that mounts afterwards takes the document over with a didChange", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, "const onDisk = 1;\n", "utf8");

    const bound = await documents.serversFor(rootPath, filePath);
    await documents.sync({ rootPath, filePath, text: "const edited = 1;\n" });

    expect(await received(bound[0].connection)).toEqual([
      expect.objectContaining({ kind: "didOpen", version: 1, text: "const onDisk = 1;\n" }),
      expect.objectContaining({ kind: "didChange", version: 2, text: "const edited = 1;\n" }),
    ]);
  });

  it("leaves the servers unopened when the file is not there", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);

    const bound = await documents.serversFor(rootPath, path.join(rootPath, "gone.ts"));

    expect(await received(bound[0].connection)).toEqual([]);
    expect(documents.openCount()).toBe(0);
  });
});

describe("answering against the draft", () => {
  it("resolves a definition from unsaved text that was never written to disk", async () => {
    const rootPath = await createRoot();
    const documents = createDocuments([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    // The file does not exist on disk at all — only in the mirror.
    await documents.sync({
      rootPath,
      filePath,
      text: "const first = 1;\nconst target = 2;\n",
    });
    const bound = await documents.serversFor(rootPath, filePath);

    const locations = await bound[0].connection.request<{ range: { start: { line: number } } }[]>(
      "textDocument/definition",
      {
        textDocument: { uri: documents.uriFor(filePath) },
        position: { line: 1, character: 6 },
      },
    );

    expect(locations[0].range.start.line).toBe(1);
  });
});
