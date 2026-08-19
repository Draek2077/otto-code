import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInstructionFileCache,
  loadInstructionFiles,
  loadSubdirectoryInstructionFile,
} from "./instruction-files.js";
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
  clearInstructionFileCache();
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
   * Files below cwd are conditional weight, not fixed: they reach the model
   * through `loadSubdirectoryInstructionFile` when the tool loop reports the
   * agent working there, and a session that never goes near `packages/app`
   * must never pay for its rules.
   */
  it("leaves instruction files below cwd to the subtree loader", async () => {
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

describe("loadSubdirectoryInstructionFile", () => {
  function loadSubtree(dir: string, overrides: { cwd?: string } = {}) {
    return loadSubdirectoryInstructionFile({
      dir,
      cwd: overrides.cwd ?? projectRoot,
      projectRoot,
      homeDir,
      env: {},
    });
  }

  it("reads the touched directory's AGENTS.md, headed by its path", async () => {
    const dir = path.join(projectRoot, "packages", "app");
    await writeFile(path.join(dir, "AGENTS.md"), "App rules.");

    const loaded = await loadSubtree(dir);

    expect(loaded.text).toContain("App rules.");
    expect(loaded.text).toContain('<instructions path="packages/app/AGENTS.md">');
    expect(loaded.paths).toEqual([path.join(dir, "AGENTS.md")]);
  });

  it("falls back to CLAUDE.md per directory, and never reads both", async () => {
    const legacy = path.join(projectRoot, "legacy");
    const both = path.join(projectRoot, "both");
    await writeFile(path.join(legacy, "CLAUDE.md"), "Legacy subtree rules.");
    await writeFile(path.join(both, "AGENTS.md"), "The real rules.");
    await writeFile(path.join(both, "CLAUDE.md"), "@AGENTS.md");

    await expect(loadSubtree(legacy)).resolves.toMatchObject({
      paths: [path.join(legacy, "CLAUDE.md")],
    });
    await expect(loadSubtree(both)).resolves.toMatchObject({
      paths: [path.join(both, "AGENTS.md")],
    });
  });

  /**
   * The same resolver, so the same rules: `@imports` are inlined recursively
   * and a markdown link stays a link. A subdirectory file that lost its imports
   * would be a second, weaker loader.
   */
  it("inlines @imports recursively and leaves markdown links alone", async () => {
    const dir = path.join(projectRoot, "packages", "app");
    await writeFile(path.join(dir, "AGENTS.md"), "App rules. @gates.md See [docs](notes.md).");
    await writeFile(path.join(dir, "gates.md"), "Gate rules. @deep.md");
    await writeFile(path.join(dir, "deep.md"), "Deep rules.");
    await writeFile(path.join(dir, "notes.md"), "Note text.");

    const loaded = await loadSubtree(dir);

    expect(loaded.text).toContain("Gate rules.");
    expect(loaded.text).toContain("Deep rules.");
    expect(loaded.text).not.toContain("Note text.");
    expect(loaded.paths).toEqual([
      path.join(dir, "AGENTS.md"),
      path.join(dir, "gates.md"),
      path.join(dir, "deep.md"),
    ]);
  });

  it("returns nothing for a directory with no instruction file", async () => {
    const dir = path.join(projectRoot, "packages", "app");
    await fs.mkdir(dir, { recursive: true });

    await expect(loadSubtree(dir)).resolves.toEqual({ text: null, paths: [] });
  });

  /**
   * The fixed chain is loaded once at spawn; a subtree load that dragged the
   * root's rules along would send them twice and bill for both.
   */
  it("reads only the named directory, never the chain above it", async () => {
    const dir = path.join(projectRoot, "packages", "app");
    await writeFile(path.join(ottoHome, "AGENTS.md"), "Machine-wide rules.");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Repo rules.");
    await writeFile(path.join(projectRoot, "packages", "AGENTS.md"), "Packages rules.");
    await writeFile(path.join(dir, "AGENTS.md"), "App rules.");

    const loaded = await loadSubtree(dir);

    expect(loaded.paths).toEqual([path.join(dir, "AGENTS.md")]);
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

  /**
   * The conditional half of the same invariant. Every `conditional` row the tab
   * shows is a file the tool loop can actually inject, and every file it can
   * inject was on the report first - including the per-directory fallback, the
   * one place two spellings could silently diverge.
   */
  it("scans exactly the files the subtree loader can inject", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "Repo rules.");
    await writeFile(path.join(projectRoot, "packages", "app", "AGENTS.md"), "App rules.");
    await writeFile(path.join(projectRoot, "packages", "legacy", "CLAUDE.md"), "Legacy rules.");
    await writeFile(path.join(projectRoot, "packages", "both", "AGENTS.md"), "Both rules.");
    await writeFile(path.join(projectRoot, "packages", "both", "CLAUDE.md"), "@AGENTS.md");

    const resolution = { cwd: projectRoot, projectRoot, homeDir, env: {} };
    const scan = await scanContextGraph(OPENAI_COMPAT_CONTEXT_FAMILY, resolution, {
      ownsContextPayload: true,
    });
    const conditional = scan.nodes
      .filter((node) => node.category === "context_files" && node.costClass === "conditional")
      .map((node) => node.path)
      .sort();

    // What the loader would inject, asked directory by directory, exactly as
    // the tool loop asks it.
    const injectable: string[] = [];
    for (const dir of ["packages/app", "packages/legacy", "packages/both"]) {
      const loaded = await loadSubdirectoryInstructionFile({
        dir: path.join(projectRoot, ...dir.split("/")),
        ...resolution,
      });
      injectable.push(...loaded.paths);
    }

    expect(conditional).toEqual(injectable.sort());
  });
});

/**
 * The cache is invalidated by mtime, so these tests set mtimes explicitly
 * rather than letting the clock decide. Two fixed timestamps, both far enough
 * in the past to clear `MTIME_SETTLE_MS` - a file written moments ago is
 * deliberately not cached at all, which is the one case where the loader
 * prefers a re-read to a stamp it cannot fully trust.
 */
const SETTLED = new Date("2026-01-01T00:00:00.000Z");
const SETTLED_LATER = new Date("2026-01-02T00:00:00.000Z");

async function setMtime(absolutePath: string, when: Date): Promise<void> {
  await fs.utimes(absolutePath, when, when);
}

describe("the workspace cache", () => {
  /**
   * The only honest proof of a hit: change the bytes on disk while leaving the
   * stamp (mtime and size) untouched. A loader that re-read the file would see
   * the new text; one served from cache still answers with the old.
   */
  it("serves a repeat load of an unchanged workspace from cache", async () => {
    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "First rules.");
    await setMtime(agentsFile, SETTLED);

    const first = await load();
    expect(first.text).toContain("First rules.");

    await fs.writeFile(agentsFile, "Other rules.", "utf8");
    await setMtime(agentsFile, SETTLED);

    const second = await load();
    expect(second.text).toContain("First rules.");
    expect(second.text).not.toContain("Other rules.");
    expect(second.paths).toEqual(first.paths);
  });

  /**
   * The reason loading is runtime-only in the first place: an edit to
   * `AGENTS.md` has to reach the next session. A cache that outlived one would
   * silently revert the user's rules.
   */
  it("re-reads a loaded file after it is edited", async () => {
    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "First rules.");
    await setMtime(agentsFile, SETTLED);
    await load();

    await fs.writeFile(agentsFile, "Rewritten rules.", "utf8");
    await setMtime(agentsFile, SETTLED_LATER);

    const reloaded = await load();
    expect(reloaded.text).toContain("Rewritten rules.");
    expect(reloaded.text).not.toContain("First rules.");
  });

  /** Stat-ing only what resolved would never notice this file arriving. */
  it("notices an AGENTS.md appearing in a workspace that had none", async () => {
    const empty = await load();
    expect(empty.text).toBeNull();

    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "Brand new rules.");
    await setMtime(agentsFile, SETTLED);

    const loaded = await load();
    expect(loaded.text).toContain("Brand new rules.");
  });

  /**
   * The same hole one step subtler: the slot was filled, by the fallback. An
   * added `AGENTS.md` takes it from the `CLAUDE.md` that was standing in, and
   * every file that *did* resolve is still byte-for-byte unchanged.
   */
  it("notices an AGENTS.md taking the slot from a cached CLAUDE.md", async () => {
    const claudeFile = path.join(projectRoot, "CLAUDE.md");
    await writeFile(claudeFile, "Legacy rules.");
    await setMtime(claudeFile, SETTLED);

    const first = await load();
    expect(first.paths).toEqual([claudeFile]);

    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "Current rules.");
    await setMtime(agentsFile, SETTLED);

    const second = await load();
    expect(second.paths).toEqual([agentsFile]);
    expect(second.text).toContain("Current rules.");
  });

  /** An import that was dead when the scan ran is a file that can still appear. */
  it("notices a previously dead import becoming real", async () => {
    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "Root rules. @docs/style.md");
    await setMtime(agentsFile, SETTLED);

    const first = await load();
    expect(first.text).not.toContain("Style rules.");

    const importedFile = path.join(projectRoot, "docs", "style.md");
    await writeFile(importedFile, "Style rules.");
    await setMtime(importedFile, SETTLED);

    const second = await load();
    expect(second.text).toContain("Style rules.");
  });

  it("keeps two workspaces apart", async () => {
    const otherRoot = path.join(tempRoot, "other-project");
    await writeFile(path.join(projectRoot, "AGENTS.md"), "This project's rules.");
    await writeFile(path.join(otherRoot, "AGENTS.md"), "The other project's rules.");
    await setMtime(path.join(projectRoot, "AGENTS.md"), SETTLED);
    await setMtime(path.join(otherRoot, "AGENTS.md"), SETTLED);

    const here = await load();
    const there = await loadInstructionFiles({
      cwd: otherRoot,
      projectRoot: otherRoot,
      homeDir,
      env: {},
    });
    const hereAgain = await load();

    expect(here.text).toContain("This project's rules.");
    expect(there.text).toContain("The other project's rules.");
    expect(there.text).not.toContain("This project's rules.");
    expect(hereAgain.text).toBe(here.text);
  });

  /**
   * A file written moments ago cannot be stamped confidently - a coarse
   * filesystem clock, or a write that lands mid-scan, both produce an mtime
   * that matches text it does not describe. The loader takes the miss.
   */
  it("does not cache a workspace whose files were just written", async () => {
    const agentsFile = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsFile, "First rules.");

    const first = await load();
    expect(first.text).toContain("First rules.");

    const stats = await fs.stat(agentsFile);
    await fs.writeFile(agentsFile, "Other rules.", "utf8");
    await fs.utimes(agentsFile, stats.atime, stats.mtime);

    const second = await load();
    expect(second.text).toContain("Other rules.");
  });
});
