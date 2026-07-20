import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanContextGraph } from "./context-graph-scanner.js";
import { convertEdge, renderEdgeToken } from "./edge-convert.js";

let tempRoot: string;
let projectRoot: string;
let homeDir: string;

beforeEach(async () => {
  tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "otto-edge-")));
  projectRoot = path.join(tempRoot, "project");
  homeDir = path.join(tempRoot, "home");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeFile(absolutePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

describe("renderEdgeToken", () => {
  it("writes an import as @path and a reference as a titled link", () => {
    expect(renderEdgeToken("docs/preview.md", "import")).toBe("@docs/preview.md");
    expect(renderEdgeToken("docs/preview.md", "reference")).toBe("[preview](docs/preview.md)");
  });
});

describe("convertEdge", () => {
  it("demotes an always-loaded import to a link, in place", async () => {
    const claudeMd = path.join(projectRoot, "CLAUDE.md");
    await writeFile(claudeMd, "Rules.\n\nAlso @docs/big.md for detail.\n");
    await writeFile(path.join(projectRoot, "docs", "big.md"), "detail");

    const scan = await scanContextGraph("claude", {
      cwd: projectRoot,
      projectRoot,
      homeDir,
      env: {},
    });
    const edge = scan.edges.find((candidate) => candidate.kind === "import");
    expect(edge).toBeDefined();

    const result = await convertEdge({
      filePath: claudeMd,
      rawTarget: edge!.rawTarget,
      range: edge!.range,
      target: "reference",
    });

    expect(result).toEqual({ ok: true });
    expect(await fs.readFile(claudeMd, "utf8")).toBe(
      "Rules.\n\nAlso [big](docs/big.md) for detail.\n",
    );
  });

  it("promotes a link back to an always-loaded import", async () => {
    const claudeMd = path.join(projectRoot, "CLAUDE.md");
    await writeFile(claudeMd, "See [big](docs/big.md).\n");
    await writeFile(path.join(projectRoot, "docs", "big.md"), "detail");

    const scan = await scanContextGraph("claude", {
      cwd: projectRoot,
      projectRoot,
      homeDir,
      env: {},
    });
    const edge = scan.edges.find((candidate) => candidate.kind === "reference");

    await convertEdge({
      filePath: claudeMd,
      rawTarget: edge!.rawTarget,
      range: edge!.range,
      target: "import",
    });

    expect(await fs.readFile(claudeMd, "utf8")).toBe("See @docs/big.md.\n");
  });

  it("round-trips without drifting", async () => {
    const claudeMd = path.join(projectRoot, "CLAUDE.md");
    const original = "Also @docs/big.md here.\n";
    await writeFile(claudeMd, original);
    await writeFile(path.join(projectRoot, "docs", "big.md"), "detail");

    for (const target of ["reference", "import"] as const) {
      const scan = await scanContextGraph("claude", {
        cwd: projectRoot,
        projectRoot,
        homeDir,
        env: {},
      });
      const edge = scan.edges.find((candidate) => candidate.toNodeId !== null);
      await convertEdge({
        filePath: claudeMd,
        rawTarget: edge!.rawTarget,
        range: edge!.range,
        target,
      });
    }

    expect(await fs.readFile(claudeMd, "utf8")).toBe(original);
  });

  it("refuses to write when the file moved under the recorded range", async () => {
    const claudeMd = path.join(projectRoot, "CLAUDE.md");
    await writeFile(claudeMd, "totally different contents now");

    const result = await convertEdge({
      filePath: claudeMd,
      rawTarget: "docs/big.md",
      range: { start: 0, end: 10 },
      target: "reference",
    });

    expect(result.ok).toBe(false);
    expect(await fs.readFile(claudeMd, "utf8")).toBe("totally different contents now");
  });

  it("reports a readable error for a missing file instead of throwing", async () => {
    const result = await convertEdge({
      filePath: path.join(projectRoot, "nope.md"),
      rawTarget: "docs/big.md",
      range: { start: 0, end: 10 },
      target: "import",
    });

    expect(result.ok).toBe(false);
  });
});
