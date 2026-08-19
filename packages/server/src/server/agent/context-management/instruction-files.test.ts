import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadInstructionFiles } from "./instruction-files.js";
import { scanContextGraph, type ScanContextGraphOptions } from "./context-graph-scanner.js";
import { OPENAI_COMPAT_CONTEXT_FAMILY } from "./provider-conventions.js";

/**
 * Real temp trees, no mocked filesystem - what this module does is decide which
 * files exist and read them, so a fake `fs` would test nothing
 * (docs/testing.md).
 */
let tempRoot: string;
let projectRoot: string;
let homeDir: string;
let ottoHome: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "otto-instructions-"));
  projectRoot = path.join(tempRoot, "project");
  homeDir = path.join(tempRoot, "home");
  ottoHome = path.join(homeDir, ".otto");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(ottoHome, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeFile(absolutePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

function load(overrides: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return loadInstructionFiles({
    cwd: overrides.cwd ?? projectRoot,
    projectRoot,
    homeDir,
    env: overrides.env ?? {},
  });
}

describe("loadInstructionFiles", () => {
  it("returns no text when the workspace has no instruction files", async () => {
    const loaded = await load();
    expect(loaded.text).toBeNull();
    expect(loaded.paths).toEqual([]);
  });

  it("loads the project's AGENTS.md, headed by its path", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Never use em-dashes.");

    const loaded = await load();

    expect(loaded.text).toContain("Never use em-dashes.");
    expect(loaded.text).toContain('<instructions path="AGENTS.md">');
    expect(loaded.paths).toEqual([path.join(projectRoot, "AGENTS.md")]);
  });

  it("falls back to CLAUDE.md when the directory has no AGENTS.md", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "Legacy project rules.");

    const loaded = await load();

    expect(loaded.text).toContain("Legacy project rules.");
    expect(loaded.paths).toEqual([path.join(projectRoot, "CLAUDE.md")]);
  });

  /**
   * The case this repo is: `CLAUDE.md` exists purely to point at `AGENTS.md`.
   * Reading both would send the same rules twice and bill for both.
   */
  it("reads only AGENTS.md when a directory carries both files", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "The real rules.");
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "@AGENTS.md");

    const loaded = await load();

    expect(loaded.paths).toEqual([path.join(projectRoot, "AGENTS.md")]);
    expect(loaded.text).not.toContain("@AGENTS.md");
  });

  it("inlines @imports recursively and counts a shared import once", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Root rules. @docs/style.md");
    await writeFile(path.join(projectRoot, "docs", "style.md"), "Style rules. @tone.md");
    await writeFile(path.join(projectRoot, "docs", "tone.md"), "Tone rules.");

    const loaded = await load();

    expect(loaded.text).toContain("Root rules.");
    expect(loaded.text).toContain("Style rules.");
    expect(loaded.text).toContain("Tone rules.");
    expect(loaded.paths).toHaveLength(3);
  });

  /**
   * The import/reference split is the whole cost model: a markdown link costs
   * the link text and nothing more, because the model reads it with a file tool
   * only if it decides to.
   */
  it("does not inline markdown links", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "See [style](docs/style.md).");
    await writeFile(path.join(projectRoot, "docs", "style.md"), "Style rules.");

    const loaded = await load();

    expect(loaded.text).toContain("See [style](docs/style.md).");
    expect(loaded.text).not.toContain("Style rules.");
    expect(loaded.paths).toEqual([path.join(projectRoot, "AGENTS.md")]);
  });

  it("survives an import cycle without repeating a file", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Root. @a.md");
    await writeFile(path.join(projectRoot, "a.md"), "A. @AGENTS.md");

    const loaded = await load();

    expect(loaded.paths).toHaveLength(2);
    expect(loaded.text?.match(/Root\./g)).toHaveLength(1);
  });

  it("loads the global AGENTS.md from $OTTO_HOME ahead of the project's", async () => {
    await writeFile(path.join(ottoHome, "AGENTS.md"), "Machine-wide rules.");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Project rules.");

    const loaded = await load({ env: { OTTO_HOME: ottoHome } });

    expect(loaded.paths).toEqual([
      path.join(ottoHome, "AGENTS.md"),
      path.join(projectRoot, "AGENTS.md"),
    ]);
    expect(loaded.text?.indexOf("Machine-wide rules.")).toBeLessThan(
      loaded.text?.indexOf("Project rules.") ?? -1,
    );
  });

  it("defaults the global file to ~/.otto/AGENTS.md when OTTO_HOME is unset", async () => {
    await writeFile(path.join(ottoHome, "AGENTS.md"), "Machine-wide rules.");

    const loaded = await load();

    expect(loaded.paths).toEqual([path.join(ottoHome, "AGENTS.md")]);
  });

  /**
   * Ancestors run outermost first so the most specific instructions land last
   * and read as the most authoritative.
   */
  it("loads the cwd chain up to the project root, outermost first", async () => {
    const nested = path.join(projectRoot, "packages", "app");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Repo rules.");
    await writeFile(path.join(projectRoot, "packages", "AGENTS.md"), "Packages rules.");
    await writeFile(path.join(nested, "AGENTS.md"), "App rules.");

    const loaded = await load({ cwd: nested });

    expect(loaded.paths).toEqual([
      path.join(projectRoot, "AGENTS.md"),
      path.join(projectRoot, "packages", "AGENTS.md"),
      path.join(nested, "AGENTS.md"),
    ]);
  });

  /**
   * Deferred, not forgotten: until the tool loop injects these mid-session,
   * loading them would be weight the Context Management report cannot honestly
   * describe as either fixed or conditional.
   */
  it("ignores instruction files below cwd", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Repo rules.");
    await writeFile(path.join(projectRoot, "packages", "app", "AGENTS.md"), "App rules.");

    const loaded = await load();

    expect(loaded.paths).toEqual([path.join(projectRoot, "AGENTS.md")]);
    expect(loaded.text).not.toContain("App rules.");
  });

  it("skips a file that is empty or only whitespace", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "   \n\n  ");

    const loaded = await load();

    expect(loaded.text).toBeNull();
  });
});

/**
 * The invariant the whole design rests on: the tab reports from the same
 * resolver the prompt is built from. If these two ever disagree, Context
 * Management is describing a session that does not exist.
 */
describe("the report and the prompt agree", () => {
  it("scans exactly the files the loader sends", async () => {
    await writeFile(path.join(ottoHome, "AGENTS.md"), "Machine-wide rules.");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Repo rules. @docs/style.md");
    await writeFile(path.join(projectRoot, "docs", "style.md"), "Style rules.");
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "@AGENTS.md");

    const resolution = { cwd: projectRoot, projectRoot, homeDir, env: {} };
    const options: ScanContextGraphOptions = { ownsContextPayload: true, fixedOnly: true };
    const scan = await scanContextGraph(OPENAI_COMPAT_CONTEXT_FAMILY, resolution, options);
    const loaded = await loadInstructionFiles(resolution);

    const scanned = scan.nodes
      .filter((node) => node.category === "context_files" && node.costClass === "fixed")
      .map((node) => node.path);
    expect(scanned).toEqual(loaded.paths);
    expect(scan.confidence).toBe("exact");
  });
});
