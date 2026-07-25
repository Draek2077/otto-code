import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LspServerNotFoundError, LspServerPool, LspServerUnavailableError } from "./pool.js";
import type { LspServerRow } from "./registry.js";

const stubServer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures",
  "stub-language-server.mjs",
);
const logger = pino({ level: "silent" });

const tempRoots: string[] = [];
const pools: LspServerPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.stopAll()));
  // Windows keeps a handle on a directory that was a child process's cwd for a
  // moment after it exits, so removal needs to retry.
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-lsp-pool-"));
  tempRoots.push(dir);
  return dir;
}

interface StubRowInput {
  id: string;
  extensions?: readonly string[];
  mode?: string;
}

/** A row whose "binary" is node running our stub server: real spawn, real framing. */
function stubRow(input: StubRowInput): LspServerRow {
  return {
    id: input.id,
    languageIds: ["plaintext"],
    extensions: input.extensions ?? [".ts"],
    bin: "node",
    args: [stubServer, input.mode ?? "normal"],
    discovery: ["path"],
    defaultEnabled: true,
    indexCost: "none",
  };
}

function missingRow(id: string, extensions: readonly string[] = [".ts"]): LspServerRow {
  return {
    id,
    languageIds: ["plaintext"],
    extensions,
    bin: "otto-nonexistent-language-server",
    args: [],
    discovery: ["path"],
    defaultEnabled: true,
    indexCost: "none",
  };
}

interface CreatePoolInput {
  rows: readonly LspServerRow[];
  maxRunningServers?: number;
  now?: () => number;
}

function createPool(input: CreatePoolInput): LspServerPool {
  const pool = new LspServerPool({
    rows: input.rows,
    logger,
    limits: {
      maxRunningServers: input.maxRunningServers ?? 8,
      idleMs: 600_000,
      backgroundIdleMs: 120_000,
      crashBackoffMs: 1000,
      maxCrashBackoffMs: 30_000,
      initializeTimeoutMs: 15_000,
      requestTimeoutMs: 5000,
    },
    now: input.now ?? (() => 0),
  });
  pools.push(pool);
  return pool;
}

describe("acquiring servers", () => {
  it("starts nothing until a document asks for one", async () => {
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });

    expect(pool.running()).toEqual([]);
  });

  it("reuses one server for repeated requests in the same workspace", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });

    const first = await pool.acquire(rootPath, "stub");
    const second = await pool.acquire(rootPath, "stub");

    expect(second).toBe(first);
    expect(pool.running()).toHaveLength(1);
  });

  it("does not start the same server twice when asked concurrently", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });

    const [first, second] = await Promise.all([
      pool.acquire(rootPath, "stub"),
      pool.acquire(rootPath, "stub"),
    ]);

    expect(second).toBe(first);
    expect(pool.running()).toHaveLength(1);
  });

  it("keys servers per workspace, so two workspaces get their own", async () => {
    const [first, second] = await Promise.all([createRoot(), createRoot()]);
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });

    const a = await pool.acquire(first, "stub");
    const b = await pool.acquire(second, "stub");

    expect(a).not.toBe(b);
    expect(pool.running()).toHaveLength(2);
  });

  it("throws a typed error when the machine has no such server", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [missingRow("absent")] });

    await expect(pool.acquire(rootPath, "absent")).rejects.toThrow(LspServerNotFoundError);
  });

  it("throws for a server id that is not in the registry at all", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });

    await expect(pool.acquire(rootPath, "nope")).rejects.toThrow(LspServerNotFoundError);
  });
});

describe("binding a document to servers", () => {
  it("binds one document to every server that claims its extension", async () => {
    const rootPath = await createRoot();
    const pool = createPool({
      rows: [stubRow({ id: "typescriptish" }), stubRow({ id: "angularish" })],
    });

    const bound = await pool.serversForDocument(rootPath, path.join(rootPath, "src", "a.ts"));

    expect(bound.map((entry) => entry.serverId).sort()).toEqual(["angularish", "typescriptish"]);
    expect(pool.running()).toHaveLength(2);
  });

  it("binds only the servers whose extensions match", async () => {
    const rootPath = await createRoot();
    const pool = createPool({
      rows: [
        stubRow({ id: "tsish", extensions: [".ts"] }),
        stubRow({ id: "pyish", extensions: [".py"] }),
      ],
    });

    const bound = await pool.serversForDocument(rootPath, path.join(rootPath, "a.py"));

    expect(bound.map((entry) => entry.serverId)).toEqual(["pyish"]);
  });

  it("returns the servers it could start and skips the ones this machine lacks", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "present" }), missingRow("absent")] });

    const bound = await pool.serversForDocument(rootPath, path.join(rootPath, "a.ts"));

    expect(bound.map((entry) => entry.serverId)).toEqual(["present"]);
  });

  it("binds nothing for an extension no server claims", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "stub", extensions: [".ts"] })] });

    expect(await pool.serversForDocument(rootPath, path.join(rootPath, "notes.md"))).toEqual([]);
  });
});

describe("reporting what is running", () => {
  it("reports workspace, server and uptime for the running-servers table", async () => {
    const rootPath = await createRoot();
    let clock = 1000;
    const pool = createPool({ rows: [stubRow({ id: "stub" })], now: () => clock });

    await pool.acquire(rootPath, "stub");
    clock = 6000;

    expect(pool.running()).toEqual([
      { rootPath, serverId: "stub", startedAt: 1000, uptimeMs: 5000, lastUsedAt: 1000 },
    ]);
  });
});

describe("stopping servers", () => {
  it("stops only the workspace it is asked to stop", async () => {
    const [first, second] = await Promise.all([createRoot(), createRoot()]);
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });
    await pool.acquire(first, "stub");
    await pool.acquire(second, "stub");

    await pool.stopWorkspace(first);

    expect(pool.running().map((entry) => entry.rootPath)).toEqual([second]);
  });

  it("stops everything on daemon shutdown", async () => {
    const [first, second] = await Promise.all([createRoot(), createRoot()]);
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });
    await pool.acquire(first, "stub");
    await pool.acquire(second, "stub");

    await pool.stopAll();

    expect(pool.running()).toEqual([]);
  });

  it("re-acquires after a deliberate stop", async () => {
    const rootPath = await createRoot();
    const pool = createPool({ rows: [stubRow({ id: "stub" })] });
    const first = await pool.acquire(rootPath, "stub");

    await pool.stopWorkspace(rootPath);
    const second = await pool.acquire(rootPath, "stub");

    expect(second).not.toBe(first);
    expect(pool.running()).toHaveLength(1);
  });
});

describe("resource limits", () => {
  it("evicts the least recently used server at the cap", async () => {
    const roots = await Promise.all([createRoot(), createRoot(), createRoot()]);
    let clock = 0;
    const pool = createPool({
      rows: [stubRow({ id: "stub" })],
      maxRunningServers: 2,
      now: () => clock,
    });

    clock = 100;
    await pool.acquire(roots[0], "stub");
    clock = 200;
    await pool.acquire(roots[1], "stub");
    clock = 300;
    await pool.acquire(roots[0], "stub");
    clock = 400;
    await pool.acquire(roots[2], "stub");

    expect(
      pool
        .running()
        .map((entry) => entry.rootPath)
        .sort(),
    ).toEqual([roots[0], roots[2]].sort());
  });

  it("reaps a server idle past the foreground timeout and keeps a fresh one", async () => {
    const [idle, fresh] = await Promise.all([createRoot(), createRoot()]);
    let clock = 0;
    const pool = createPool({ rows: [stubRow({ id: "stub" })], now: () => clock });

    await pool.acquire(idle, "stub");
    clock = 500_000;
    await pool.acquire(fresh, "stub");

    clock = 1_000_000;
    await pool.reapIdle();

    expect(pool.running().map((entry) => entry.rootPath)).toEqual([fresh]);
  });

  it("reaps a background workspace sooner than the active one", async () => {
    const [active, background] = await Promise.all([createRoot(), createRoot()]);
    let clock = 0;
    const pool = createPool({ rows: [stubRow({ id: "stub" })], now: () => clock });

    await pool.acquire(active, "stub");
    await pool.acquire(background, "stub");
    pool.setActiveWorkspace(active);

    clock = 200_000;
    await pool.reapIdle();

    expect(pool.running().map((entry) => entry.rootPath)).toEqual([active]);
  });
});

describe("surviving a crash", () => {
  it("refuses immediately after a crash, then restarts once the backoff expires", async () => {
    const rootPath = await createRoot();
    let clock = 0;
    const pool = createPool({ rows: [stubRow({ id: "stub" })], now: () => clock });

    const connection = await pool.acquire(rootPath, "stub");
    connection.notify("stub/die", {});
    await connection.whenExited;

    await expect(pool.acquire(rootPath, "stub")).rejects.toThrow(LspServerUnavailableError);

    clock = 5000;
    const restarted = await pool.acquire(rootPath, "stub");
    expect(restarted).not.toBe(connection);
    expect(pool.running()).toHaveLength(1);
  });

  it("lengthens the backoff on repeated crashes without exceeding the cap", async () => {
    const rootPath = await createRoot();
    let clock = 0;
    const pool = createPool({ rows: [stubRow({ id: "stub" })], now: () => clock });

    const delays: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const connection = await pool.acquire(rootPath, "stub");
      connection.notify("stub/die", {});
      await connection.whenExited;

      const failure = await pool
        .acquire(rootPath, "stub")
        .then(() => null)
        .catch((error: LspServerUnavailableError) => error);
      expect(failure).toBeInstanceOf(LspServerUnavailableError);
      delays.push(failure!.retryInMs);
      clock += failure!.retryInMs;
    }

    expect(delays).toEqual([1000, 2000, 4000]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000);
  });
});
