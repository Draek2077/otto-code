import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { LanguageServerPool, DEFAULT_POLICY } from "./pool.js";
import { SERVER_ROWS, type ServerRow } from "./registry.js";
import { fileUri } from "./uri.js";

const fixture = fileURLToPath(new URL("./fixtures/server.mjs", import.meta.url));
const row: ServerRow = {
  ...SERVER_ROWS[0],
  id: "fixture",
  command: "node",
  args: [fixture],
  bundled: false,
};

describe("Otto host-wide language-server pool", () => {
  it("reuses a workspace process, enforces the cap, replays drafts after eviction, and stops disabled servers", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "otto-lsp-pool-"));
    const rootA = path.join(home, "a");
    const rootB = path.join(home, "b");
    await mkdir(rootA);
    await mkdir(rootB);
    let policy = { ...DEFAULT_POLICY, maxServers: 1 };
    const gone: string[] = [];
    const pool = new LanguageServerPool({
      rows: [row],
      logger: pino({ level: "silent" }),
      policy: () => policy,
      onDiagnostics: () => undefined,
      onServerGone: (root) => gone.push(root),
    });
    const fileA = path.join(rootA, "a.ts");
    try {
      const first = await pool.withDocument(rootA, fileA, async ([server]) => {
        await server.connection.sync(fileA, "draft-a", server.languageId);
        return server.connection.request("fixture/pid", {});
      });
      expect(pool.running()).toHaveLength(1);
      expect(
        await pool.withDocument(rootA, fileA, ([server]) =>
          server.connection.request("fixture/pid", {}),
        ),
      ).toBe(first);
      await pool.withDocument(rootB, path.join(rootB, "b.ts"), async (servers) => {
        expect(servers).toHaveLength(1);
      });
      expect(gone).toContain(rootA);
      await pool.withDocument(rootA, fileA, async ([server]) => {
        await server.connection.sync(fileA, "newest-a", server.languageId);
        expect(
          await server.connection.request("fixture/read", { uri: fileUri(fileA) }),
        ).toMatchObject({ text: "newest-a", version: 1 });
      });
      policy = { ...policy, enabled: false };
      await pool.applyPolicy();
      expect(pool.running()).toHaveLength(0);
      await expect(pool.withDocument(rootA, fileA, async () => null)).rejects.toMatchObject({
        kind: "unavailable",
      });
    } finally {
      await pool.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reaps only idle processes and closes all children at daemon shutdown", async () => {
    const root = path.dirname(fixture);
    const policy = { ...DEFAULT_POLICY, idleMs: 100, backgroundIdleMs: 50 };
    const pool = new LanguageServerPool({
      rows: [row],
      logger: pino({ level: "silent" }),
      policy: () => policy,
      onDiagnostics: () => undefined,
      onServerGone: () => undefined,
    });
    try {
      await pool.withDocument(root, path.join(root, "a.ts"), async () => {
        await pool.reapIdle(Date.now() + 1000);
        expect(pool.running()).toHaveLength(1);
      });
      await pool.reapIdle(Date.now() + 1000);
      expect(pool.running()).toHaveLength(0);
    } finally {
      await pool.close();
    }
    await expect(
      pool.withDocument(root, path.join(root, "a.ts"), async () => null),
    ).rejects.toMatchObject({ kind: "closed" });
  });
});
