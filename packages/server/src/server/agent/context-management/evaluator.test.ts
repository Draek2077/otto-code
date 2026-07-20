import { describe, expect, it } from "vitest";
import type { ContextGraphScanResult } from "./context-graph-scanner.js";
import { evaluateContext, severityForShare } from "./evaluator.js";
import type { ContextCategory, ContextCostClass, ContextNode } from "./types.js";

function node(
  id: string,
  estTokens: number,
  costClass: ContextCostClass = "fixed",
  category: ContextCategory = "context_files",
): ContextNode {
  return {
    id,
    path: `/tmp/${id}`,
    relPath: id,
    scope: "project",
    category,
    costClass,
    bytes: estTokens * 4,
    estTokens,
    alsoImportedByNodeIds: [],
    findings: [],
  };
}

function scan(nodes: ContextNode[]): ContextGraphScanResult {
  return {
    nodes,
    edges: [],
    findings: [],
    confidence: "convention",
    supportsImports: true,
    supported: true,
  };
}

function evaluate(nodes: ContextNode[], windowTokens: number) {
  return evaluateContext({
    provider: "claude",
    windowTokens,
    scan: scan(nodes),
    scannedAt: "2026-07-19T00:00:00.000Z",
  });
}

describe("severityForShare", () => {
  it("escalates across the default bands", () => {
    expect(severityForShare(5)).toBe("ok");
    expect(severityForShare(10)).toBe("notice");
    expect(severityForShare(25)).toBe("warn");
    expect(severityForShare(50)).toBe("critical");
  });
});

describe("evaluateContext", () => {
  it("scores identical weight differently against different windows", () => {
    // The single most important property: 12K tokens is nothing at 1M and half
    // the budget at 32K. Absolute thresholds would call these the same.
    const nodes = [node("CLAUDE.md", 12_000)];

    expect(evaluate(nodes, 1_000_000).aggregateSeverity).toBe("ok");
    expect(evaluate(nodes, 200_000).aggregateSeverity).toBe("ok");
    expect(evaluate(nodes, 32_000).aggregateSeverity).toBe("warn");
    expect(evaluate(nodes, 20_000).aggregateSeverity).toBe("critical");
  });

  it("counts only fixed weight toward the window share", () => {
    const report = evaluate(
      [
        node("fixed.md", 10_000),
        node("subdir.md", 50_000, "conditional"),
        node("linked.md", 90_000, "referenced"),
      ],
      100_000,
    );

    expect(report.fixedTotal).toBe(10_000);
    expect(report.conditionalTotal).toBe(50_000);
    expect(report.referencedTotal).toBe(90_000);
    expect(report.categoryTotals[0]?.sharePercent).toBe(10);
  });

  it("reports working room left for the conversation", () => {
    const report = evaluate([node("CLAUDE.md", 14_000)], 200_000);

    expect(report.workingRoom).toBe(186_000);
  });

  it("is critical when fixed context cannot fit the window at all", () => {
    const report = evaluate([node("huge.md", 40_000)], 32_000);

    expect(report.aggregateSeverity).toBe("critical");
    expect(report.workingRoom).toBe(0);
  });

  it("rolls each category up separately", () => {
    const report = evaluate(
      [
        node("CLAUDE.md", 6_000),
        node("MEMORY.md", 5_000, "fixed", "memory_index"),
        node("skill", 3_000, "fixed", "skills_roster"),
      ],
      100_000,
    );

    expect(report.categoryTotals.map((total) => total.category)).toEqual([
      "context_files",
      "memory_index",
      "skills_roster",
    ]);
    expect(report.fixedTotal).toBe(14_000);
  });

  it("folds in runtime weight Otto knows exactly", () => {
    const report = evaluateContext({
      provider: "openai-compat",
      windowTokens: 100_000,
      scan: scan([node("CLAUDE.md", 6_000)]),
      scannedAt: "2026-07-19T00:00:00.000Z",
      runtimeTokensByCategory: { mcp_tools: 9_000, otto_injected: 1_000 },
    });

    expect(report.fixedTotal).toBe(16_000);
    expect(report.categoryTotals.find((total) => total.category === "mcp_tools")?.estTokens).toBe(
      9_000,
    );
  });

  it("escalates the aggregate when one category is worse than the total share", () => {
    // Aggregate share is 30% (warn), but skills alone are 50% of nothing useful
    // — the worst category must not be hidden by a healthier average.
    const report = evaluate(
      [node("CLAUDE.md", 5_000), node("skills", 25_000, "fixed", "skills_roster")],
      50_000,
    );

    expect(
      report.categoryTotals.find((total) => total.category === "skills_roster")?.severity,
    ).toBe("critical");
    expect(report.aggregateSeverity).toBe("critical");
  });
});
