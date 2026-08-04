import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function createService(rows: readonly LspServerRow[], now: () => number = () => 0): LspService {
  const service = LspService.create({ logger, rows, now });
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

  // The defect this exists to prevent, measured on this repo 2026-07-25: for the ~7s after
  // spawn that tsserver spends loading the project, `fromFileUri` reported 2 hits in 1 file
  // when the truth was 14 in 4. It answered `ok` the whole time, because the old rule only
  // reported `indexing` for an EMPTY result. A complete-looking answer that is 7x short is
  // worse than no answer, so indexing now outranks having results.
  it("reports indexing even when it found some references, because the set may be partial", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    await service.references({ rootPath, filePath, line: 2, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    const partial = await service.references({ rootPath, filePath, line: 2, column: 7 });
    expect(partial.status).toBe("indexing");
    // The partial set still comes back - a provisional list beats an empty one, as long as
    // the caller is told it is provisional.
    expect(partial.locations).toHaveLength(1);

    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-end");
    const settled = await service.references({ rootPath, filePath, line: 2, column: 7 });
    expect(settled.status).toBe("ok");
  });
});

describe("rename, as a dry run", () => {
  it("returns every edit it would make without writing anything", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    // `use12(` is six characters, so `target` starts at column 7 on BOTH lines - which is
    // where the stub plans its edits. The alignment matters: the plan is grounded against the
    // real file, so a position that landed mid-word would faithfully capture the mid-word
    // text, and the run would then correctly refuse it.
    const text = "const target = 1;\nuse12(target);\n";
    // Written to disk as well as synced: the plan captures the text each edit would replace,
    // which is what makes the job verifiable and reversible later.
    await writeFile(filePath, text, "utf8");
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
          { line: 1, column: 7, endLine: 1, endColumn: 13, newText: "renamed", oldText: "target" },
          { line: 2, column: 7, endLine: 2, endColumn: 13, newText: "renamed", oldText: "target" },
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

    expect(plan).toEqual({
      status: "ok",
      files: [],
      fileCount: 0,
      editCount: 0,
      planId: "",
      error: null,
    });
  });

  // Every other request degrades to a bad answer while the project loads; this one degrades
  // to a destructive edit. So it refuses outright rather than returning an under-reported
  // plan that a UI would present as the complete blast radius.
  it("refuses to plan at all while a bound server is still indexing", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    await service.references({ rootPath, filePath, line: 2, column: 7 });
    const [entry] = service.running();
    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-begin");

    const blocked = await service.renamePreview({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
    });
    expect(blocked).toEqual({
      status: "indexing",
      files: [],
      fileCount: 0,
      editCount: 0,
      planId: "",
      error: null,
    });

    await service.requestOnServer(rootPath, entry.serverId, "stub/progress-end");
    const settled = await service.renamePreview({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
    });
    expect(settled.status).toBe("ok");
    expect(settled.editCount).toBeGreaterThan(0);
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

  it("reports every language host-wide, with no workspace in hand", async () => {
    const projectOnly: LspServerRow = { ...stubRow("project-only"), discovery: ["workspaceBin"] };
    const service = createService([stubRow("on-path"), projectOnly]);

    const languages = await service.languageStates(null);

    expect(languages).toEqual([
      expect.objectContaining({
        id: "on-path",
        installed: true,
        rung: "path",
        discovery: ["path"],
      }),
      // The host cannot supply it and never could: the row says so instead of the screen
      // asking for a workspace before it will speak.
      expect.objectContaining({
        id: "project-only",
        installed: false,
        rung: null,
        path: null,
        discovery: ["workspaceBin"],
      }),
    ]);
    expect(languages[0]?.path).toContain("node");
  });

  it("counts a host-wide language as running wherever its server is rooted", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    await service.definition({ rootPath, filePath, line: 2, column: 7 });

    const languages = await service.languageStates(null);

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
  // Revised deliberately in Phase 5b. This used to assert the opposite - that a sync
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

// The daemon supplies the tick (`reapIdle` on an interval) and this service supplies the
// other half: which workspace counts as the one in front of the user. Without that, every
// server gets the long allowance forever and `backgroundIdleMinutes` means nothing.
describe("the idle policy", () => {
  it("gives the workspace of the latest request the long allowance and the other the short one", async () => {
    const [background, active] = await Promise.all([createRoot(), createRoot()]);
    let clock = 0;
    const service = createService([stubRow("stub")], () => clock);

    await service.syncDocument({
      rootPath: background,
      filePath: path.join(background, "a.ts"),
      text: DRAFT,
    });
    await service.syncDocument({
      rootPath: active,
      filePath: path.join(active, "a.ts"),
      text: DRAFT,
    });

    // Past the 2-minute background allowance, well short of the 10-minute foreground one.
    clock = 3 * 60_000;
    await service.reapIdle();

    expect(service.running().map((entry) => entry.rootPath)).toEqual([active]);
  });

  it("counts a lookup as looking at that workspace, not only a buffer sync", async () => {
    const [first, second] = await Promise.all([createRoot(), createRoot()]);
    let clock = 0;
    const service = createService([stubRow("stub")], () => clock);

    const filePath = path.join(first, "a.ts");
    await service.syncDocument({ rootPath: first, filePath, text: DRAFT });
    await service.syncDocument({
      rootPath: second,
      filePath: path.join(second, "a.ts"),
      text: DRAFT,
    });

    // The user goes back to the first workspace and asks it something.
    clock = 1000;
    await service.definition({ rootPath: first, filePath, line: 2, column: 7 });

    clock = 3 * 60_000 + 1000;
    await service.reapIdle();

    expect(service.running().map((entry) => entry.rootPath)).toEqual([first]);
  });

  it("keeps a server alive while it is still being used", async () => {
    const rootPath = await createRoot();
    let clock = 0;
    const service = createService([stubRow("stub")], () => clock);
    const filePath = path.join(rootPath, "a.ts");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    clock = 9 * 60_000;
    await service.definition({ rootPath, filePath, line: 2, column: 7 });
    clock = 15 * 60_000;
    await service.reapIdle();

    expect(service.running()).toHaveLength(1);
  });
});

// The only method in this subsystem that writes a file, so its guards get tested rather
// than trusted. The stub renames whatever `target` it finds, which is enough to exercise
// every gate.
// The only path in this subsystem that writes a file, so its behaviour is proven rather than
// trusted. The engine's own guarantees are covered in edit-job.test.ts; these check that the
// service wires the right plan to the right run and refuses what it should.
describe("rename, applied", () => {
  const RENAMED = "const first = 1;\nconst renamed = 2;\nconst last = 3;\n";

  async function planFor(service: LspService, rootPath: string, filePath: string) {
    return service.renamePreview({ rootPath, filePath, line: 2, column: 7, newName: "renamed" });
  }

  it("runs the plan that was audited and reports it complete", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const plan = await planFor(service, rootPath, filePath);
    const applied = await service.renameApply({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
      planId: plan.planId,
    });

    expect(applied.status).toBe("ok");
    expect(applied.complete).toBe(true);
    expect(applied.appliedEdits).toBe(plan.editCount);
    expect(applied.runId).not.toBeNull();
    expect(await readFile(filePath, "utf8")).toBe(RENAMED);
  });

  // The plan carries the text each edit replaces, so it can be checked against reality at run
  // time. This is what replaced the old all-or-nothing "recompute and refuse" gate.
  it("records the text each edit expects to replace", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const plan = await planFor(service, rootPath, filePath);

    expect(plan.files[0].edits[0].oldText).toBe("target");
  });

  // The case that made the old design wrong for Otto: an agent writes to the file while the
  // user is auditing. The job runs; only the edit whose ground truth moved is skipped.
  it("applies what still fits when the file changed under the plan", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });
    const plan = await planFor(service, rootPath, filePath);

    await writeFile(filePath, "const first = 1;\nconst MOVED = 2;\nconst last = 3;\n", "utf8");

    const applied = await service.renameApply({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
      planId: plan.planId,
    });

    // The run still HAPPENS - that is the point of the status. This file contributed one
    // edit and it moved, so the file itself failed while the run reports honestly on it.
    expect(applied.status).toBe("ok");
    expect(applied.complete).toBe(false);
    expect(applied.skippedEdits).toBeGreaterThan(0);
    expect(applied.files[0].kind).toBe("failed");
    expect(applied.files[0].reason).toContain("changed after the plan");
  });

  it("puts the files back on undo", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const plan = await planFor(service, rootPath, filePath);
    const applied = await service.renameApply({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
      planId: plan.planId,
    });
    const undone = await service.renameUndo(applied.runId ?? "");

    expect(undone.status).toBe("ok");
    expect(undone.complete).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(DRAFT);
  });

  it("reports a plan the host no longer holds rather than guessing at one", async () => {
    const rootPath = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(rootPath, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const applied = await service.renameApply({
      rootPath,
      filePath,
      line: 2,
      column: 7,
      newName: "renamed",
      planId: "never-planned",
    });

    expect(applied.status).toBe("expired");
    expect(applied.runId).toBeNull();
    expect(await readFile(filePath, "utf8")).toBe(DRAFT);
  });

  it("reports an unknown run rather than pretending to undo it", async () => {
    const service = createService([stubRow("stub")]);

    expect((await service.renameUndo("never-ran")).status).toBe("expired");
  });

  // A language server is a foreign process that answers in paths. One naming a file outside
  // the workspace must not turn the daemon into a write primitive for it - and it is refused
  // at PLAN time, so an unrunnable plan is never shown as if it could run.
  it("refuses to plan at all when the server names a file outside the workspace", async () => {
    const rootPath = await createRoot();
    const outsideRoot = await createRoot();
    const service = createService([stubRow("stub")]);
    const filePath = path.join(outsideRoot, "a.ts");
    await writeFile(filePath, DRAFT, "utf8");
    await service.syncDocument({ rootPath, filePath, text: DRAFT });

    const plan = await planFor(service, rootPath, filePath);

    expect(plan.status).toBe("unavailable");
    expect(plan.error).toContain("outside this workspace");
    expect(await readFile(filePath, "utf8")).toBe(DRAFT);
  });
});
