import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanContextGraph } from "./context-graph-scanner.js";
import {
  getProviderConvention,
  isContextScanSupported,
  type ContextResolutionInput,
} from "./provider-conventions.js";

/**
 * The OMP entry is a description of a subprocess, so these tests pin the
 * behavior that was actually measured off `omp` 16.3.6 (finding
 * `omp-pi-instruction-file-discovery`) rather than the shape of the code that
 * describes it. Each case names the payload observation it stands for; if OMP
 * changes its discovery order, these are what should fail first.
 */

let tempRoot: string;
let projectRoot: string;
let homeDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "otto-omp-context-"));
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

function input(overrides: Partial<ContextResolutionInput> = {}): ContextResolutionInput {
  return { cwd: projectRoot, projectRoot, homeDir, env: {}, ...overrides };
}

async function scannedPaths(overrides: Partial<ContextResolutionInput> = {}): Promise<string[]> {
  const result = await scanContextGraph("omp", input(overrides));
  expect(result.supported).toBe(true);
  return result.nodes.map((node) => node.path);
}

describe("omp convention", () => {
  it("scans, unlike an unregistered provider", () => {
    expect(isContextScanSupported("omp")).toBe(true);
    expect(getProviderConvention("omp")?.confidence).toBe("convention");
  });

  it("takes the project slot with AGENTS.md", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "project rules");

    expect(await scannedPaths()).toContain(path.join(projectRoot, "AGENTS.md"));
  });

  // Measured: with both present, only `.omp/AGENTS.md` reached the payload -
  // OMP's own discovery provider outranks the plain AGENTS.md walk, and one
  // slot holds one file.
  it("lets .omp/AGENTS.md shadow AGENTS.md in the same directory", async () => {
    await writeFile(path.join(projectRoot, ".omp", "AGENTS.md"), "omp native");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "plain");

    const paths = await scannedPaths();
    expect(paths).toContain(path.join(projectRoot, ".omp", "AGENTS.md"));
    expect(paths).not.toContain(path.join(projectRoot, "AGENTS.md"));
  });

  // Measured, and the surprising half of the order: `.claude/CLAUDE.md` beats
  // the plain `AGENTS.md` sitting beside it.
  it("lets .claude/CLAUDE.md shadow AGENTS.md at cwd", async () => {
    await writeFile(path.join(projectRoot, ".claude", "CLAUDE.md"), "claude rules");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "plain");

    const paths = await scannedPaths();
    expect(paths).toContain(path.join(projectRoot, ".claude", "CLAUDE.md"));
    expect(paths).not.toContain(path.join(projectRoot, "AGENTS.md"));
  });

  // Measured: with cwd a level down, the ancestor's `.claude/` was never read -
  // that loader joins onto cwd rather than walking - while the ancestor's plain
  // `AGENTS.md` was.
  it("reads an ancestor's AGENTS.md but not its .claude/CLAUDE.md", async () => {
    const cwd = path.join(projectRoot, "sub");
    await fs.mkdir(cwd, { recursive: true });
    await writeFile(path.join(projectRoot, "AGENTS.md"), "root rules");
    await writeFile(path.join(projectRoot, ".claude", "CLAUDE.md"), "root claude");
    await writeFile(path.join(cwd, "AGENTS.md"), "sub rules");

    const paths = await scannedPaths({ cwd });
    expect(paths).toContain(path.join(projectRoot, "AGENTS.md"));
    expect(paths).toContain(path.join(cwd, "AGENTS.md"));
    expect(paths).not.toContain(path.join(projectRoot, ".claude", "CLAUDE.md"));
  });

  // Measured: OMP adopts another harness's global file when it has none of its
  // own, and `~/.claude/CLAUDE.md` outranks the Codex, Gemini and OpenCode
  // globals.
  it("adopts ~/.claude/CLAUDE.md as the global slot, behind OMP's own", async () => {
    await writeFile(path.join(homeDir, ".claude", "CLAUDE.md"), "global claude");
    await writeFile(path.join(homeDir, ".codex", "AGENTS.md"), "global codex");

    const adopted = await scannedPaths();
    expect(adopted).toContain(path.join(homeDir, ".claude", "CLAUDE.md"));
    expect(adopted).not.toContain(path.join(homeDir, ".codex", "AGENTS.md"));

    await writeFile(path.join(homeDir, ".omp", "agent", "AGENTS.md"), "global omp");

    const owned = await scannedPaths();
    expect(owned).toContain(path.join(homeDir, ".omp", "agent", "AGENTS.md"));
    expect(owned).not.toContain(path.join(homeDir, ".claude", "CLAUDE.md"));
  });

  // Measured: a file one directory below cwd never appeared in the payload.
  // OMP's walk only climbs, so there is no conditional subtree to report.
  it("reports no weight below cwd", async () => {
    await writeFile(path.join(projectRoot, "deeper", "AGENTS.md"), "never sent");

    const result = await scanContextGraph("omp", input());
    expect(result.nodes.map((node) => node.path)).not.toContain(
      path.join(projectRoot, "deeper", "AGENTS.md"),
    );
    expect(result.nodes.every((node) => node.costClass === "fixed")).toBe(true);
  });
});

describe("pi", () => {
  // Not an oversight: Pi's instruction-file behavior was never established, and
  // an empty report is the honest one. See the comment above `CONVENTIONS`.
  it("has no convention, so the tab reports that it cannot see", () => {
    expect(isContextScanSupported("pi")).toBe(false);
    expect(getProviderConvention("pi")).toBeNull();
  });
});
