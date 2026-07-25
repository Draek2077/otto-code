import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LspService } from "./service.js";
import type { LspServerRow } from "./registry.js";

const stubServer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures",
  "stub-language-server.mjs",
);
const logger = pino({ level: "silent" });

const tempRoots: string[] = [];
const services: LspService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-lsp-service-"));
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

function createService(rows: readonly LspServerRow[]): LspService {
  const service = LspService.create({ logger, rows, now: () => 0 });
  services.push(service);
  return service;
}

/** The stub answers definitions by finding the line containing `target`. */
const DRAFT = "const first = 1;\nconst target = 2;\nconst last = 3;\n";

describe("resolving a definition", () => {
  it("answers from the synced draft, in 1-based positions", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result).toEqual({
      status: "ok",
      locations: [
        {
          path: filePath,
          // `target` is on the second line: 0-based 1 from the server, 1-based 2 here.
          line: 2,
          column: 1,
          endLine: 2,
          endColumn: 7,
          serverId: "stub",
        },
      ],
      error: null,
    });
  });

  it("reports unavailable when the host has no server for the language", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub", [".ts"])]);
    const filePath = path.join(rootPath, "notes.md");
    await service.syncDocument({ rootPath, filePath, text: "# target\n" });

    const result = await service.definition({ rootPath, filePath, line: 1, column: 1 });

    expect(result.status).toBe("unavailable");
    expect(result.locations).toEqual([]);
  });

  it("reports not-found as an empty ok, not as unavailable", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    const result = await service.definition({ rootPath, filePath, line: 1, column: 7 });

    expect(result).toEqual({ status: "ok", locations: [], error: null });
  });

  it("merges and dedupes answers from every bound server", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("tsish"), stubRow("angularish")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    // Both servers see the same draft and answer identically; one location survives.
    expect(result.status).toBe("ok");
    expect(result.locations).toHaveLength(1);
    expect(service.running()).toHaveLength(2);
  });

  it("attributes each location to the server that produced it", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("tsish")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    // The picker shows this, so a user can tell a resolved overload from a name match.
    expect(result.locations[0].serverId).toBe("tsish");
  });

  it("still answers when one bound server cannot be started", async () => {
    const rootPath = await createRoot();
    const missing: LspServerRow = {
      id: "absent",
      languageIds: ["plaintext"],
      extensions: [".ts"],
      bin: "otto-nonexistent-language-server",
      args: [],
      discovery: ["path"],
      defaultEnabled: true,
      indexCost: "none",
    };
    const service = createService([stubRow("present"), missing]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("ok");
    expect(result.locations).toHaveLength(1);
  });

  it("reports indexing rather than not-found while a server has progress in flight", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    // Warm the server, then put it into a work-done-progress window.
    await service.definition({ rootPath, filePath, line: 1, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    const indexing = await service.definition({ rootPath, filePath, line: 1, column: 7 });
    expect(indexing.status).toBe("indexing");

    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-end");
    const settled = await service.definition({ rootPath, filePath, line: 1, column: 7 });
    expect(settled.status).toBe("ok");
  });

  it("does not report indexing when it actually found something", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    await service.definition({ rootPath, filePath, line: 2, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("ok");
    expect(result.locations).toHaveLength(1);
  });
});

describe("hover", () => {
  it("returns the server's explanation for the symbol under the caret", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.hover({ rootPath, filePath, line: 2, column: 7 });

    expect(result).toEqual({
      status: "ok",
      markdown: "**target**: the symbol under the caret",
      range: { line: 2, column: 1, endLine: 2, endColumn: 7 },
      serverId: "stub",
      error: null,
    });
  });

  it("reports nothing to say as ok with no content, not as a failure", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    const result = await service.hover({ rootPath, filePath, line: 1, column: 7 });

    expect(result.status).toBe("ok");
    expect(result.markdown).toBeNull();
  });

  it("reports unavailable when no server covers the language", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub", [".ts"])]);
    const filePath = path.join(rootPath, "notes.md");
    await service.syncDocument({ rootPath, filePath, text: "# target\n" });

    expect((await service.hover({ rootPath, filePath, line: 1, column: 1 })).status).toBe(
      "unavailable",
    );
  });

  it("reports indexing rather than nothing-to-say while the server is still working", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    await service.hover({ rootPath, filePath, line: 1, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    expect((await service.hover({ rootPath, filePath, line: 1, column: 7 })).status).toBe(
      "indexing",
    );

    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-end");
    expect((await service.hover({ rootPath, filePath, line: 1, column: 7 })).status).toBe("ok");
  });

  it("does not report indexing when the server actually answered", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    await service.hover({ rootPath, filePath, line: 2, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    const result = await service.hover({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("ok");
    expect(result.markdown).toBe("**target**: the symbol under the caret");
  });
});

describe("find references", () => {
  it("returns every reference, in 1-based positions", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({
      rootPath,
      filePath,
      text: "const target = 1;\nconst other = 2;\nuse(target);\n",
    });

    const result = await service.references({ rootPath, filePath, line: 1, column: 7 });

    expect(result.status).toBe("ok");
    expect(result.locations).toEqual([
      expect.objectContaining({ path: filePath, line: 1, column: 7, serverId: "stub" }),
      expect.objectContaining({ path: filePath, line: 3, column: 7, serverId: "stub" }),
    ]);
  });

  it("dedupes identical hits reported by two bound servers", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("tsish"), stubRow("angularish")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.references({ rootPath, filePath, line: 2, column: 7 });

    expect(result.locations).toHaveLength(1);
  });

  it("reports no references as ok with an empty list", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    const result = await service.references({ rootPath, filePath, line: 1, column: 7 });

    expect(result).toEqual({ status: "ok", locations: [], error: null });
  });
});

describe("rename, as a dry run", () => {
  it("returns every edit it would make without writing anything", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    const text = "const target = 1;\nuse(target);\n";
    await service.syncDocument({ rootPath, filePath, text });

    const plan = await service.renamePreview({
      rootPath,
      filePath,
      line: 1,
      column: 7,
      newName: "renamed",
    });

    expect(plan.status).toBe("ok");
    expect(plan.files).toEqual([
      {
        path: filePath,
        edits: [
          { line: 1, column: 7, endLine: 1, endColumn: 13, newText: "renamed" },
          { line: 2, column: 7, endLine: 2, endColumn: 13, newText: "renamed" },
        ],
      },
    ]);
    expect(plan.editCount).toBe(2);
    expect(plan.fileCount).toBe(1);
  });

  it("reports a symbol the server refuses to rename as ok with an empty plan", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: "const nothing = 1;\n" });

    const plan = await service.renamePreview({
      rootPath,
      filePath,
      line: 1,
      column: 7,
      newName: "renamed",
    });

    expect(plan).toEqual({ status: "ok", files: [], fileCount: 0, editCount: 0, error: null });
  });

  it("sorts edits within a file so a preview reads top to bottom", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({
      rootPath,
      filePath,
      text: "use(target);\nconst x = 1;\nconst target = 2;\n",
    });

    const plan = await service.renamePreview({
      rootPath,
      filePath,
      line: 1,
      column: 5,
      newName: "renamed",
    });

    expect(plan.files[0].edits.map((edit) => edit.line)).toEqual([1, 3]);
  });
});

describe("honouring the host's settings", () => {
  it("spawns nothing at all when code intelligence is switched off", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    service.setSettings({ enabled: false });
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("unavailable");
    expect(service.running()).toEqual([]);
  });

  it("stops servers that are already running when it is switched off", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });
    expect(service.running()).toHaveLength(1);

    await service.applySettings({ enabled: false });

    expect(service.running()).toEqual([]);
  });

  it("skips a language the host disabled while keeping the others", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("keep"), stubRow("drop")]);
    service.setSettings({ enabled: true, languages: { drop: false } });
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("ok");
    expect(service.running().map((entry) => entry.serverId)).toEqual(["keep"]);
  });

  it("falls back to the row's own default when the host says nothing", async () => {
    const rootPath = await createRoot();
    const offByDefault: LspServerRow = { ...stubRow("angularish"), defaultEnabled: false };
    const service = createService([stubRow("tsish"), offByDefault]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(service.running().map((entry) => entry.serverId)).toEqual(["tsish"]);
  });

  it("lets the host turn on a row that ships off", async () => {
    const rootPath = await createRoot();
    const offByDefault: LspServerRow = { ...stubRow("angularish"), defaultEnabled: false };
    const service = createService([offByDefault]);
    service.setSettings({ enabled: true, languages: { angularish: true } });
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const result = await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(result.status).toBe("ok");
    expect(service.running().map((entry) => entry.serverId)).toEqual(["angularish"]);
  });

  it("reports each language's availability for the settings screen", async () => {
    const rootPath = await createRoot();
    const missing: LspServerRow = {
      ...stubRow("absent"),
      bin: "otto-nonexistent-language-server",
    };
    const service = createService([stubRow("present"), missing]);

    const languages = await service.languageStates(rootPath);

    expect(languages).toEqual([
      expect.objectContaining({ id: "present", enabled: true, installed: true, running: false }),
      expect.objectContaining({ id: "absent", enabled: true, installed: false, running: false }),
    ]);
  });

  it("marks a language as running once it is up", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    const languages = await service.languageStates(rootPath);

    expect(languages[0]).toEqual(expect.objectContaining({ id: "stub", running: true }));
  });
});

describe("reporting activity so a cold start is visible", () => {
  it("reports the workspace busy while a server is indexing, and idle after", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    expect(service.busyRoots()).toEqual([]);

    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");
    expect(service.busyRoots()).toEqual([rootPath]);

    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-end");
    expect(service.busyRoots()).toEqual([]);
  });

  it("notifies a listener on each transition and never twice for the same set", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const seen: string[][] = [];
    service.onActivityChange((busyRoots) => seen.push(busyRoots));

    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    // Spawning is itself activity: busy while starting, idle once it is up.
    expect(seen).toEqual([[rootPath], []]);

    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    // The second begin carries the same token, so the busy set never changed.
    expect(seen).toEqual([[rootPath], [], [rootPath]]);
  });

  it("reports one entry per workspace even with several servers busy", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("tsish"), stubRow("angularish")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    for (const entry of service.running()) {
      await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");
    }

    expect(service.busyRoots()).toEqual([rootPath]);
  });
});

describe("document lifecycle through the service", () => {
  // Revised deliberately in Phase 5b. This used to assert the opposite — that a sync
  // started nothing and only a query did. Diagnostics are pushed, so a file whose server
  // is not running has no diagnostics at all, and waiting for a hover would mean a broken
  // file looked clean until the user happened to point at it. Opening a file IS the
  // code-intelligence action now; the master switch, per-language toggles, LRU cap and
  // idle reap are what keep that affordable.
  it("starts the document's servers on sync, because diagnostics have nothing to push otherwise", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);

    await service.syncDocument({ rootPath, filePath: path.join(rootPath, "a.ts"), text: DRAFT });

    expect(service.running().map((entry) => entry.serverId)).toEqual(["stub"]);
    expect(service.openDocumentCount()).toBe(1);
  });

  it("starts nothing for a language with no row, so an unsupported file costs nothing", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);

    await service.syncDocument({
      rootPath,
      filePath: path.join(rootPath, "notes.md"),
      text: DRAFT,
    });

    expect(service.running()).toEqual([]);
    expect(service.openDocumentCount()).toBe(1);
  });

  it("drops the document on close", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");

    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.closeDocument({ rootPath, filePath });

    expect(service.openDocumentCount()).toBe(0);
  });

  it("stops a workspace's servers and forgets its documents together", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    await service.stopWorkspace(rootPath);

    expect(service.running()).toEqual([]);
    expect(service.openDocumentCount()).toBe(0);
  });
});
