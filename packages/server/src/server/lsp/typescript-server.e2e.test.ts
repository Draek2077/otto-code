import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LspConnection } from "./connection.js";
import { LSP_SERVER_ROWS, resolveServerCommand, type LspServerRow } from "./registry.js";

/**
 * The charter's Phase 1 acceptance criterion: spawn a real
 * `typescript-language-server` against a fixture workspace and get a real
 * `initialize` result back. Nothing is stubbed here — this is the proof that the
 * transport, the Windows `.cmd` shim path, and the handshake work together.
 */

const logger = pino({ level: "silent" });
const typescriptRow: LspServerRow = LSP_SERVER_ROWS.find((row) => row.id === "typescript")!;

const tempRoots: string[] = [];
const started: LspConnection[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((connection) => connection.stop()));
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFixtureWorkspace(directoryName = "otto-lsp-ts-"): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), directoryName));
  tempRoots.push(rootPath);

  await writeFile(
    path.join(rootPath, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" }, include: ["src"] }),
  );
  await mkdir(path.join(rootPath, "src"), { recursive: true });
  await writeFile(
    path.join(rootPath, "src", "greet.ts"),
    "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n",
  );
  await writeFile(
    path.join(rootPath, "src", "main.ts"),
    'import { greet } from "./greet.js";\n\nconsole.log(greet("otto"));\n',
  );

  return rootPath;
}

describe("typescript-language-server", () => {
  it("resolves from our bundled copy", async () => {
    const rootPath = await createFixtureWorkspace();

    const resolved = await resolveServerCommand(typescriptRow, rootPath);

    expect(resolved).not.toBeNull();
    expect(resolved?.rung).toBe("bundled");
    expect(resolved?.args).toEqual(["--stdio"]);
  });

  it("completes a real initialize handshake and advertises definition support", async () => {
    const rootPath = await createFixtureWorkspace();
    const resolved = await resolveServerCommand(typescriptRow, rootPath);
    expect(resolved).not.toBeNull();

    const connection = await LspConnection.start({
      spec: {
        id: typescriptRow.id,
        command: resolved!.command,
        args: resolved!.args,
        rootPath,
      },
      logger,
      initializeTimeoutMs: 20000,
      requestTimeoutMs: 20000,
      onExit: () => {},
    });
    started.push(connection);

    // typescript-language-server 5.3 answers with `capabilities` only; serverInfo
    // is optional in LSP and it does not send one.
    expect(connection.capabilities.definitionProvider).toBe(true);
    expect(connection.isRunning).toBe(true);
  });

  it("starts from a workspace whose path contains a space", async () => {
    const rootPath = await createFixtureWorkspace("otto lsp spaced ");
    const resolved = await resolveServerCommand(typescriptRow, rootPath);

    const connection = await LspConnection.start({
      spec: {
        id: typescriptRow.id,
        command: resolved!.command,
        args: resolved!.args,
        rootPath,
      },
      logger,
      initializeTimeoutMs: 20000,
      requestTimeoutMs: 20000,
      onExit: () => {},
    });
    started.push(connection);

    expect(connection.capabilities.definitionProvider).toBe(true);
  });

  it("shuts down on request", async () => {
    const rootPath = await createFixtureWorkspace();
    const resolved = await resolveServerCommand(typescriptRow, rootPath);

    const connection = await LspConnection.start({
      spec: {
        id: typescriptRow.id,
        command: resolved!.command,
        args: resolved!.args,
        rootPath,
      },
      logger,
      initializeTimeoutMs: 20000,
      requestTimeoutMs: 20000,
      onExit: () => {},
    });

    await connection.stop();

    expect(connection.isRunning).toBe(false);
  });
});
