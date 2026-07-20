import { describe, expect, it } from "vitest";
import { collectContentFindings, type ContextFileContent } from "./content-findings.js";
import type { ContextCategory, ContextNode, ContextScope } from "./types.js";

function file(
  id: string,
  text: string,
  overrides: { scope?: ContextScope; category?: ContextCategory } = {},
): ContextFileContent {
  const node: ContextNode = {
    id,
    path: `/repo/${id}`,
    relPath: id,
    scope: overrides.scope ?? "project",
    category: overrides.category ?? "context_files",
    costClass: "fixed",
    bytes: text.length,
    estTokens: Math.round(text.length / 4),
    alsoImportedByNodeIds: [],
    findings: [],
  };
  return { node, text };
}

const RULE = "Always run typecheck and lint after every change, without exception, every time.";
const OTHER_RULE = "Never restart the main daemon on port 6868 without explicit permission first.";

describe("collectContentFindings", () => {
  it("flags a rule duplicated between global and project scope", () => {
    const global = file("~/.claude/CLAUDE.md", `# Global\n\n${RULE}\n`, { scope: "global" });
    const project = file("CLAUDE.md", `# Project\n\n${RULE}\n`);

    collectContentFindings([global, project]);

    const finding = [...global.node.findings, ...project.node.findings].find(
      (candidate) => candidate.kind === "duplicate_across_scope",
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("sent twice");
  });

  it("does not flag two project files sharing a block", () => {
    // Composition inside one scope is usually deliberate.
    const a = file("CLAUDE.md", `${RULE}\n`);
    const b = file("docs/a.md", `${RULE}\n`);

    collectContentFindings([a, b]);

    expect([...a.node.findings, ...b.node.findings]).toEqual([]);
  });

  it("ignores short repeated boilerplate", () => {
    const global = file("~/.claude/CLAUDE.md", "## Rules\n\n- Be nice\n", { scope: "global" });
    const project = file("CLAUDE.md", "## Rules\n\n- Be nice\n");

    collectContentFindings([global, project]);

    expect([...global.node.findings, ...project.node.findings]).toEqual([]);
  });

  it("matches across reflowed whitespace and casing", () => {
    const global = file("~/.claude/CLAUDE.md", `${RULE}\n`, { scope: "global" });
    const reflowed = RULE.replace(" without exception", "\n   WITHOUT exception");
    const project = file("CLAUDE.md", `${reflowed}\n`);

    collectContentFindings([global, project]);

    expect(
      [...global.node.findings, ...project.node.findings].some(
        (finding) => finding.kind === "duplicate_across_scope",
      ),
    ).toBe(true);
  });

  it("flags a block repeated inside one file", () => {
    const single = file("CLAUDE.md", `${RULE}\n\n${OTHER_RULE}\n\n${RULE}\n`);

    collectContentFindings([single]);

    expect(single.node.findings).toContainEqual(
      expect.objectContaining({ kind: "duplicate_within_file" }),
    );
  });

  it("gives a within-file duplicate a range that selects the repeat", () => {
    const text = `${RULE}\n\n${RULE}\n`;
    const single = file("CLAUDE.md", text);

    collectContentFindings([single]);

    const finding = single.node.findings.find(
      (candidate) => candidate.kind === "duplicate_within_file",
    );
    expect(finding?.range).toBeDefined();
    expect(text.slice(finding!.range!.start, finding!.range!.end).trim()).toBe(RULE);
  });

  it("flags a memory index line that has grown into a paragraph", () => {
    const long = `- [Thing](thing.md) — ${"detail ".repeat(40)}`;
    const memory = file("MEMORY.md", `# Index\n\n- [Short](a.md) — hook\n${long}\n`, {
      category: "memory_index",
    });

    collectContentFindings([memory]);

    const finding = memory.node.findings.find(
      (candidate) => candidate.kind === "oversized_memory_entry",
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("one line per entry");
  });

  it("leaves a well-formed memory index alone", () => {
    const memory = file("MEMORY.md", "# Index\n\n- [Short](a.md) — a brief hook\n", {
      category: "memory_index",
    });

    collectContentFindings([memory]);

    expect(memory.node.findings).toEqual([]);
  });

  it("does not apply the memory line rule to ordinary context files", () => {
    const long = `Prose that runs long is normal in a rules file. ${"and on ".repeat(40)}`;
    const claude = file("CLAUDE.md", long);

    collectContentFindings([claude]);

    expect(claude.node.findings).toEqual([]);
  });
});
