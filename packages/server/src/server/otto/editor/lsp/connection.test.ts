import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";
import { LanguageConnection } from "./connection.js";
import { SERVER_ROWS, type ServerRow } from "./registry.js";
import { fileUri } from "./uri.js";
import type { PublishedDiagnostics } from "./schema.js";

const root = fileURLToPath(new URL("./fixtures", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/server.mjs", import.meta.url));
const row: ServerRow = { ...SERVER_ROWS[0], id: "fixture", command: "node", args: [fixture] };
function create(published: PublishedDiagnostics[]) {
  return new LanguageConnection({
    row,
    root,
    launch: { command: process.execPath, args: [fixture], source: "path" },
    logger: pino({ level: "silent" }),
    requestMs: 1000,
    onDiagnostics: (value) => published.push(value),
    onExit: () => undefined,
  });
}

describe("Otto language-server connection", () => {
  it("uses advertised capabilities without requiring serverInfo; mirrors latest drafts and closes them", async () => {
    const published: PublishedDiagnostics[] = [];
    const connection = create(published);
    try {
      await connection.start();
      expect(connection.supports("hover")).toBe(true);
      expect(connection.supports("completion")).toBe(true);
      const file = path.join(root, "hash # unicode é.ts");
      const uri = fileUri(file);
      await connection.sync(file, "first", "typescript");
      await connection.sync(file, "changed", "typescript");
      expect(await connection.request("fixture/read", { uri })).toMatchObject({
        text: "changed",
        version: 2,
      });
      await expect.poll(() => published.at(-1)?.diagnostics[0]?.message).toBe("changed");
      const count = published.length;
      await connection.request("fixture/diagnostic", { uri, version: 1, diagnostics: [] });
      await connection.request("fixture/read", { uri });
      expect(published).toHaveLength(count);
      await connection.closeDocument(file);
      expect(await connection.request("fixture/read", { uri })).toBeNull();
    } finally {
      await connection.close();
    }
    expect(connection.alive).toBe(false);
  });

  it("bounds hung requests without shutting down a healthy peer", async () => {
    const connection = create([]);
    try {
      await connection.start();
      await expect(connection.request("fixture/hang", {}, 30)).rejects.toMatchObject({
        kind: "timeout",
      });
      expect(await connection.request("fixture/pid", {})).toBeGreaterThan(0);
    } finally {
      await connection.close();
    }
  });
});
