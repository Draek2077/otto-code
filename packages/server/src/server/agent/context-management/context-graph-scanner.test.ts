import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanContextGraph } from "./context-graph-scanner.js";
import { encodeClaudeProjectDir, type ContextResolutionInput } from "./provider-conventions.js";
import type { ContextNode } from "./types.js";

/**
 * Real temp trees, no mocked filesystem — the scanner's whole job is deciding
 * what exists, so a fake `fs` would test nothing (docs/testing.md).
 */
let tempRoot: string;
let projectRoot: string;
let homeDir: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "otto-context-"));
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

function nodeFor(nodes: ContextNode[], relPath: string): ContextNode | undefined {
  return nodes.find((node) => node.relPath === relPath);
}

function memoryIndexPath(): string {
  return path.join(
    homeDir,
    ".claude",
    "projects",
    encodeClaudeProjectDir(projectRoot),
    "memory",
    "MEMORY.md",
  );
}

describe("scanContextGraph", () => {
  it("reports unsupported providers rather than guessing", async () => {
    const result = await scanContextGraph("some-acp-agent", input());

    expect(result.supported).toBe(false);
    expect(result.nodes).toEqual([]);
  });

  it("resolves the project, global and memory load points as fixed weight", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "project rules");
    await writeFile(path.join(homeDir, ".claude", "CLAUDE.md"), "global rules");
    await writeFile(memoryIndexPath(), "- [a](a.md) — hook");

    const result = await scanContextGraph("claude", input());

    expect(result.supported).toBe(true);
    expect(nodeFor(result.nodes, "CLAUDE.md")).toMatchObject({
      scope: "project",
      category: "context_files",
      costClass: "fixed",
    });
    expect(nodeFor(result.nodes, "~/.claude/CLAUDE.md")).toMatchObject({
      scope: "global",
      costClass: "fixed",
    });
    expect(result.nodes.find((node) => node.category === "memory_index")).toBeDefined();
  });

  it("skips load points that do not exist", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "only this one");

    const result = await scanContextGraph("claude", input());

    expect(result.nodes).toHaveLength(1);
  });

  it("treats @import as loaded and a markdown link as merely referenced", async () => {
    await writeFile(
      path.join(projectRoot, "CLAUDE.md"),
      "Always @docs/always.md and maybe [later](docs/linked.md).",
    );
    await writeFile(path.join(projectRoot, "docs", "always.md"), "loaded content");
    await writeFile(path.join(projectRoot, "docs", "linked.md"), "not loaded");

    const result = await scanContextGraph("claude", input());

    expect(nodeFor(result.nodes, "docs/always.md")?.costClass).toBe("fixed");
    expect(nodeFor(result.nodes, "docs/linked.md")?.costClass).toBe("referenced");
    expect(result.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining(["import", "reference"]),
    );
  });

  it("does not traverse imports of a merely-referenced file", async () => {
    // The referenced file is not in the request, so nothing it imports is either.
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "[link](docs/linked.md)");
    await writeFile(path.join(projectRoot, "docs", "linked.md"), "@docs/deep.md");
    await writeFile(path.join(projectRoot, "docs", "deep.md"), "should never be reached");

    const result = await scanContextGraph("claude", input());

    expect(nodeFor(result.nodes, "docs/deep.md")).toBeUndefined();
  });

  it("gives an edge the byte range of its own token, so conversion is a single-span edit", async () => {
    const contents = "prefix @docs/a.md suffix";
    await writeFile(path.join(projectRoot, "CLAUDE.md"), contents);
    await writeFile(path.join(projectRoot, "docs", "a.md"), "x");

    const result = await scanContextGraph("claude", input());
    const edge = result.edges.find((candidate) => candidate.kind === "import");

    expect(edge).toBeDefined();
    expect(contents.slice(edge!.range.start, edge!.range.end)).toBe("@docs/a.md");
  });

  it("lists and counts a twice-imported file exactly once", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "@docs/one.md @docs/two.md");
    await writeFile(path.join(projectRoot, "docs", "one.md"), "@shared.md");
    await writeFile(path.join(projectRoot, "docs", "two.md"), "@shared.md");
    await writeFile(path.join(projectRoot, "docs", "shared.md"), "shared body");

    const result = await scanContextGraph("claude", input());
    const shared = result.nodes.filter((node) => node.relPath === "docs/shared.md");

    expect(shared).toHaveLength(1);
    expect(shared[0]?.alsoImportedByNodeIds).toHaveLength(1);
    // Both parents still show an edge — the graph is honest even though the
    // token count is not doubled.
    expect(
      result.edges.filter((edge) => edge.toNodeId === shared[0]?.id && edge.kind === "import"),
    ).toHaveLength(2);
  });

  it("terminates on an import cycle and reports it", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "@a.md");
    await writeFile(path.join(projectRoot, "a.md"), "@b.md");
    await writeFile(path.join(projectRoot, "b.md"), "@a.md");

    const result = await scanContextGraph("claude", input());

    expect(result.nodes.filter((node) => node.relPath === "a.md")).toHaveLength(1);
    expect(result.findings.some((finding) => finding.kind === "import_cycle")).toBe(true);
  });

  it("flags an always-load target that does not exist", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "@docs/missing.md");

    const result = await scanContextGraph("claude", input());

    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "dead_import" }));
  });

  it("stays quiet about scoped package mentions that are not paths", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "import from @otto-code/protocol");

    const result = await scanContextGraph("claude", input());

    expect(result.findings).toEqual([]);
  });

  it("flags a link whose target has been deleted", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "[gone](docs/gone.md)");

    const result = await scanContextGraph("claude", input());

    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "dead_reference" }));
  });

  it("classifies subdirectory context files as conditional, not fixed", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "root");
    await writeFile(path.join(projectRoot, "packages", "server", "CLAUDE.md"), "server rules");

    const result = await scanContextGraph("claude", input());

    expect(nodeFor(result.nodes, "packages/server/CLAUDE.md")).toMatchObject({
      costClass: "conditional",
      scope: "subdirectory",
    });
  });

  it("counts a skill's frontmatter, not its body", async () => {
    const frontmatter = "name: demo\ndescription: A short description.";
    const body = "x".repeat(20_000);
    await writeFile(
      path.join(homeDir, ".claude", "skills", "demo", "SKILL.md"),
      `---\n${frontmatter}\n---\n${body}`,
    );

    const result = await scanContextGraph("claude", input());
    const skill = result.nodes.find((node) => node.category === "skills_roster");

    expect(skill).toBeDefined();
    expect(skill!.bytes).toBe(frontmatter.length);
  });

  it("resolves AGENTS.md for Codex and marks the result unverified", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "codex rules");
    await writeFile(path.join(homeDir, ".codex", "AGENTS.md"), "global codex rules");

    const result = await scanContextGraph("codex", input());

    expect(result.supported).toBe(true);
    // We cannot see inside the subprocess, so the UI must not present this as fact.
    expect(result.confidence).toBe("unverified");
    // No @import mechanism is known — the "Always load" action stays disabled.
    expect(result.supportsImports).toBe(false);
    expect(nodeFor(result.nodes, "AGENTS.md")?.scope).toBe("project");
    expect(nodeFor(result.nodes, "~/.codex/AGENTS.md")?.scope).toBe("global");
  });

  it("honours CODEX_HOME when resolving the global Codex file", async () => {
    const codexHome = path.join(tempRoot, "codex-home");
    await writeFile(path.join(codexHome, "AGENTS.md"), "relocated");

    const result = await scanContextGraph(
      "codex",
      input({ env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv }),
    );

    expect(result.nodes).toHaveLength(1);
  });

  it("resolves AGENTS.md for OpenCode", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "opencode rules");

    const result = await scanContextGraph("opencode", input());

    expect(result.supported).toBe(true);
    expect(nodeFor(result.nodes, "AGENTS.md")).toBeDefined();
  });

  it("does not treat an @path as an import on a provider without imports", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "See @docs/a.md for detail.");
    await writeFile(path.join(projectRoot, "docs", "a.md"), "detail");

    const result = await scanContextGraph("codex", input());

    // The file is real, but Codex would render "@docs/a.md" as literal text —
    // counting it as loaded would overstate the bill.
    expect(nodeFor(result.nodes, "docs/a.md")).toBeUndefined();
  });

  it("ignores references inside code fences", async () => {
    await writeFile(
      path.join(projectRoot, "CLAUDE.md"),
      ["```md", "@docs/example.md", "```"].join("\n"),
    );

    const result = await scanContextGraph("claude", input());

    expect(result.edges).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
