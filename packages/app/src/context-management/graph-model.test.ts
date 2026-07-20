import { describe, expect, it } from "vitest";
import type { ContextEdge, ContextNode, ContextReport } from "@otto-code/protocol/messages";
import {
  buildContextTree,
  defaultExpandedKeys,
  pickInitialNode,
  splitAbsolutePath,
} from "./graph-model";

function node(overrides: Partial<ContextNode> & Pick<ContextNode, "id">): ContextNode {
  return {
    path: `/repo/${overrides.id}`,
    relPath: overrides.id,
    scope: "project",
    category: "context_files",
    costClass: "fixed",
    bytes: 400,
    estTokens: 100,
    alsoImportedByNodeIds: [],
    findings: [],
    ...overrides,
  };
}

function edge(from: string, to: string, kind: ContextEdge["kind"] = "import"): ContextEdge {
  return { fromNodeId: from, toNodeId: to, kind, rawTarget: to, range: { start: 0, end: 1 } };
}

function report(overrides: Partial<ContextReport> = {}): ContextReport {
  return {
    workspaceId: "w1",
    provider: "claude",
    windowTokens: 200_000,
    scannedAt: "2026-07-19T00:00:00.000Z",
    confidence: "convention",
    supported: true,
    supportsImports: true,
    nodes: [],
    edges: [],
    categoryTotals: [],
    fixedTotal: 0,
    conditionalTotal: 0,
    referencedTotal: 0,
    workingRoom: 200_000,
    aggregateSeverity: "ok",
    findings: [],
    ...overrides,
  };
}

describe("buildContextTree", () => {
  it("nests imports under the file that loads them", () => {
    const rows = buildContextTree({
      report: report({
        nodes: [node({ id: "CLAUDE.md" }), node({ id: "docs/a.md" })],
        edges: [edge("CLAUDE.md", "docs/a.md")],
      }),
      expandedKeys: new Set(["context_files", "CLAUDE.md"]),
    });

    expect(rows.map((row) => [row.key, row.depth])).toEqual([
      ["context_files", 0],
      ["CLAUDE.md", 1],
      ["docs/a.md", 2],
    ]);
  });

  it("lists a twice-imported file exactly once", () => {
    const rows = buildContextTree({
      report: report({
        nodes: [node({ id: "one.md" }), node({ id: "two.md" }), node({ id: "shared.md" })],
        edges: [edge("one.md", "shared.md"), edge("two.md", "shared.md")],
      }),
      expandedKeys: new Set(["context_files", "one.md", "two.md"]),
    });

    expect(rows.filter((row) => row.key === "shared.md")).toHaveLength(1);
  });

  it("keeps the edge kind so the tree can draw loaded vs linked differently", () => {
    const rows = buildContextTree({
      report: report({
        nodes: [node({ id: "CLAUDE.md" }), node({ id: "linked.md", costClass: "referenced" })],
        edges: [edge("CLAUDE.md", "linked.md", "reference")],
      }),
      expandedKeys: new Set(["context_files", "CLAUDE.md"]),
    });

    expect(rows.find((row) => row.key === "linked.md")?.edgeKind).toBe("reference");
  });

  it("collapses children when the parent is not expanded", () => {
    const rows = buildContextTree({
      report: report({
        nodes: [node({ id: "CLAUDE.md" }), node({ id: "docs/a.md" })],
        edges: [edge("CLAUDE.md", "docs/a.md")],
      }),
      expandedKeys: new Set(["context_files"]),
    });

    expect(rows.map((row) => row.key)).toEqual(["context_files", "CLAUDE.md"]);
    expect(rows.find((row) => row.key === "CLAUDE.md")?.expandable).toBe(true);
  });

  it("shows a category Otto only knows as a number", () => {
    const rows = buildContextTree({
      report: report({
        categoryTotals: [
          { category: "mcp_tools", estTokens: 9_000, sharePercent: 4.5, severity: "ok" },
        ],
      }),
      expandedKeys: new Set(),
    });

    expect(rows).toEqual([
      expect.objectContaining({ key: "mcp_tools", estTokens: 9_000, expandable: false }),
    ]);
  });
});

describe("pickInitialNode", () => {
  it("opens the largest project-scoped context file", () => {
    const chosen = pickInitialNode(
      report({
        nodes: [
          node({ id: "small.md", estTokens: 100 }),
          node({ id: "big.md", estTokens: 6_000 }),
          node({ id: "global.md", estTokens: 9_000, scope: "global" }),
        ],
      }),
    );

    expect(chosen?.id).toBe("big.md");
  });

  it("falls back past project scope when there is nothing project-scoped", () => {
    const chosen = pickInitialNode(report({ nodes: [node({ id: "global.md", scope: "global" })] }));

    expect(chosen?.id).toBe("global.md");
  });

  it("never opens a merely-linked file", () => {
    const chosen = pickInitialNode(
      report({ nodes: [node({ id: "linked.md", costClass: "referenced" })] }),
    );

    expect(chosen).toBeNull();
  });
});

describe("defaultExpandedKeys", () => {
  it("opens the context files branch and its loaded files", () => {
    const keys = defaultExpandedKeys(
      report({
        nodes: [node({ id: "CLAUDE.md" }), node({ id: "linked.md", costClass: "referenced" })],
      }),
    );

    expect(keys.has("context_files")).toBe(true);
    expect(keys.has("CLAUDE.md")).toBe(true);
    expect(keys.has("linked.md")).toBe(false);
  });
});

describe("splitAbsolutePath", () => {
  it("splits posix and windows paths alike", () => {
    expect(splitAbsolutePath("/home/u/.claude/CLAUDE.md")).toEqual({
      dir: "/home/u/.claude",
      base: "CLAUDE.md",
    });
    expect(splitAbsolutePath("C:\\Users\\u\\.claude\\CLAUDE.md")).toEqual({
      dir: "C:\\Users\\u\\.claude",
      base: "CLAUDE.md",
    });
  });
});
