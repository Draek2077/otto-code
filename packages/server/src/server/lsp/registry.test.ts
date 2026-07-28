import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LSP_SERVER_ROWS,
  resolveServerCommand,
  rowsForExtension,
  type LspServerRow,
} from "./registry.js";
import { isPlatform } from "../../test-utils/platform.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-lsp-registry-"));
  tempRoots.push(dir);
  return dir;
}

async function installWorkspaceBin(rootPath: string, bin: string): Promise<string> {
  const binDir = path.join(rootPath, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  const fileName = isPlatform("win32") ? `${bin}.cmd` : bin;
  const filePath = path.join(binDir, fileName);
  await writeFile(filePath, isPlatform("win32") ? "@echo off\n" : "#!/bin/sh\n");
  if (!isPlatform("win32")) {
    await chmod(filePath, 0o755);
  }
  return filePath;
}

function row(overrides: Partial<LspServerRow> = {}): LspServerRow {
  return {
    id: "test-server",
    languageIds: ["plaintext"],
    extensions: [".fake"],
    bin: "otto-nonexistent-language-server",
    args: ["--stdio"],
    discovery: ["workspaceBin", "bundled", "path"],
    defaultEnabled: true,
    indexCost: "none",
    ...overrides,
  };
}

describe("server discovery", () => {
  it("finds the workspace's own copy first", async () => {
    const rootPath = await createRoot();
    const installed = await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(row(), rootPath);

    expect(resolved).toEqual({
      command: installed,
      args: ["--stdio"],
      rung: "workspaceBin",
    });
  });

  it("returns null when no rung can supply the server", async () => {
    const rootPath = await createRoot();

    expect(await resolveServerCommand(row(), rootPath)).toBeNull();
  });

  it("skips a rung the row does not declare", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(row({ discovery: ["path"] }), rootPath);

    expect(resolved).toBeNull();
  });

  it("answers host-wide without a root, skipping the workspace rung", async () => {
    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["workspaceBin", "bundled"] }),
      null,
    );

    expect(resolved?.rung).toBe("bundled");
  });

  it("has nothing to say host-wide about a row only a project can supply", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    expect(await resolveServerCommand(row({ discovery: ["workspaceBin"] }), null)).toBeNull();
  });

  it("finds our bundled copy when the workspace has none", async () => {
    const rootPath = await createRoot();

    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["bundled"] }),
      rootPath,
    );

    expect(resolved?.rung).toBe("bundled");
    expect(resolved?.command).toContain("typescript-language-server");
  });

  it("prefers the workspace copy over our bundled one", async () => {
    const rootPath = await createRoot();
    const installed = await installWorkspaceBin(rootPath, "typescript-language-server");

    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["workspaceBin", "bundled"] }),
      rootPath,
    );

    expect(resolved?.command).toBe(installed);
  });

  it("substitutes the workspace root into args as a forward-slash path", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(
      row({ args: ["--stdio", "--tsProbeLocations", "{root}/node_modules"] }),
      rootPath,
    );

    const expectedRoot = rootPath.replace(/\\/g, "/");
    expect(resolved?.args).toEqual([
      "--stdio",
      "--tsProbeLocations",
      `${expectedRoot}/node_modules`,
    ]);
  });
});

describe("extension routing", () => {
  it("routes a TypeScript file to the TypeScript server", () => {
    const ids = rowsForExtension(".ts").map((entry) => entry.id);

    expect(ids).toContain("typescript");
  });

  it("routes one extension to several servers, which is what Angular needs", () => {
    const ids = rowsForExtension(".ts").map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining(["typescript", "angular"]));
  });

  it("is case-insensitive about the extension", () => {
    expect(rowsForExtension(".TS").map((entry) => entry.id)).toEqual(
      rowsForExtension(".ts").map((entry) => entry.id),
    );
  });

  it("returns nothing for an unhandled extension", () => {
    expect(rowsForExtension(".unknownext")).toEqual([]);
  });

  it("covers the three languages that decide whether this shipped", () => {
    const ids = LSP_SERVER_ROWS.map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining(["typescript", "python", "csharp"]));
  });

  it("routes React files through the TypeScript server", () => {
    expect(rowsForExtension(".tsx").map((entry) => entry.id)).toContain("typescript");
  });
});
