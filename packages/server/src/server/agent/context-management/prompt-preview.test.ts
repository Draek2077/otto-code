import { describe, expect, it } from "vitest";
import { buildPromptPreview } from "./prompt-preview.js";
import type {
  ContextCategory,
  ContextCategoryTotal,
  ContextCostClass,
  ContextNode,
  ContextReport,
} from "./types.js";

function node(
  relPath: string,
  category: ContextCategory,
  costClass: ContextCostClass = "fixed",
): ContextNode {
  return {
    id: relPath,
    path: `/tmp/${relPath}`,
    relPath,
    scope: "project",
    category,
    costClass,
    bytes: 10,
    estTokens: 3,
    alsoImportedByNodeIds: [],
    findings: [],
  };
}

function report(params: {
  nodes: ContextNode[];
  categoryTotals?: ContextCategoryTotal[];
}): ContextReport {
  return {
    provider: "claude",
    windowTokens: 200_000,
    scannedAt: "2026-07-26T00:00:00.000Z",
    confidence: "convention",
    nodes: params.nodes,
    edges: [],
    categoryTotals: params.categoryTotals ?? [],
    fixedTotal: 0,
    conditionalTotal: 0,
    referencedTotal: 0,
    workingRoom: 200_000,
    aggregateSeverity: "ok",
    findings: [],
  };
}

function total(
  category: ContextCategory,
  visibility: ContextCategoryTotal["visibility"],
): ContextCategoryTotal {
  return { category, estTokens: 0, sharePercent: 0, severity: "ok", visibility };
}

const readFile = (contents: Record<string, string>) => async (absolutePath: string) => {
  const found = contents[absolutePath];
  if (found == null) throw new Error(`missing ${absolutePath}`);
  return found;
};

describe("buildPromptPreview", () => {
  it("assembles sections in the order the model receives them", async () => {
    const preview = await buildPromptPreview({
      report: report({
        nodes: [node("CLAUDE.md", "context_files"), node("MEMORY.md", "memory_index")],
      }),
      runtimeTextByCategory: { otto_injected: "personality brief" },
      readFile: readFile({ "/tmp/CLAUDE.md": "rules", "/tmp/MEMORY.md": "index" }),
    });

    expect(preview.sections.map((section) => section.category)).toEqual([
      "otto_injected",
      "context_files",
      "memory_index",
    ]);
  });

  it("assembles only the requested category, and reads nothing else", async () => {
    const read = readFile({ "/tmp/CLAUDE.md": "rules" });
    let reads = 0;
    const preview = await buildPromptPreview({
      report: report({ nodes: [node("CLAUDE.md", "context_files")] }),
      runtimeTextByCategory: { otto_injected: "team + personality" },
      categories: ["otto_injected"],
      readFile: async (path) => {
        reads += 1;
        return read(path);
      },
    });

    // Reading Otto's own injected stack must not drag every context file in
    // with it - not in the text, and not in the token figure above it.
    expect(preview.sections).toEqual([
      expect.objectContaining({ category: "otto_injected", text: "team + personality" }),
    ]);
    expect(reads).toBe(0);
  });

  it("keeps an unmeasurable section with no text rather than omitting it", async () => {
    const preview = await buildPromptPreview({
      report: report({
        nodes: [],
        categoryTotals: [total("system_prompt", "not_visible")],
      }),
    });

    const section = preview.sections.find((entry) => entry.category === "system_prompt");
    // Present, explained, and carrying no body - an omitted section would read
    // as "the provider sends nothing before your files", which is false.
    expect(section).toMatchObject({ visibility: "not_visible" });
    expect(section?.text).toBeUndefined();
  });

  it("excludes conditional and referenced files, which are not in the request", async () => {
    const preview = await buildPromptPreview({
      report: report({
        nodes: [
          node("CLAUDE.md", "context_files"),
          node("packages/server/CLAUDE.md", "context_files", "conditional"),
          node("docs/linked.md", "context_files", "referenced"),
        ],
      }),
      readFile: readFile({ "/tmp/CLAUDE.md": "rules" }),
    });

    expect(preview.sections.map((section) => section.label)).toEqual(["CLAUDE.md"]);
  });

  it("shows only the frontmatter of a roster entry", async () => {
    const preview = await buildPromptPreview({
      report: report({ nodes: [node("skills/deploy/SKILL.md", "skills_roster")] }),
      readFile: readFile({
        "/tmp/skills/deploy/SKILL.md": "---\nname: deploy\n---\nthe long body",
      }),
    });

    // The body loads on invocation, not on every request. Rendering it here
    // would contradict the token figure sitting next to it.
    expect(preview.sections[0]?.text).toBe("name: deploy");
    expect(preview.sections[0]?.text).not.toContain("long body");
  });

  it("skips a file that has disappeared since the scan instead of failing", async () => {
    const preview = await buildPromptPreview({
      report: report({
        nodes: [node("CLAUDE.md", "context_files"), node("gone.md", "context_files")],
      }),
      readFile: readFile({ "/tmp/CLAUDE.md": "rules" }),
    });

    expect(preview.sections.map((section) => section.label)).toEqual(["CLAUDE.md"]);
  });

  it("totals only the sections that carry text", async () => {
    const preview = await buildPromptPreview({
      report: report({
        nodes: [node("CLAUDE.md", "context_files")],
        categoryTotals: [total("mcp_tools", "not_visible")],
      }),
      readFile: readFile({ "/tmp/CLAUDE.md": "12345678" }),
    });

    expect(preview.estTokens).toBe(2);
  });
});
