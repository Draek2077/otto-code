/**
 * Turns a resolved graph into a report (charter §4).
 *
 * The whole point of this module is that severity is a **share of the model's
 * context window**, never an absolute token count: 6K tokens is a rounding
 * error at 1M and half the budget at 32K, and Otto ships local models as
 * first-class citizens.
 *
 * Only **fixed** weight drives severity. Conditional and referenced totals are
 * reported separately — folding them into the percentage would claim a cost the
 * user is not actually paying on every request.
 */

import type { ContextGraphScanResult } from "./context-graph-scanner.js";
import type {
  ContextCategory,
  ContextCategoryTotal,
  ContextReport,
  ContextSeverity,
} from "./types.js";

export interface ContextThresholds {
  /** Share of window at which a category/aggregate starts being reported. */
  noticePercent: number;
  warnPercent: number;
  criticalPercent: number;
}

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = {
  noticePercent: 10,
  warnPercent: 25,
  criticalPercent: 50,
};

/**
 * Common context windows, for the what-if picker. The default is deliberately
 * NOT the largest: defaulting to 1M would report "you're fine" to everyone and
 * make the feature useless. Callers pass the active model's real window when
 * they know it and fall back to this.
 */
export const CONTEXT_WINDOW_PRESETS = [
  { label: "32K", tokens: 32_000 },
  { label: "128K", tokens: 128_000 },
  { label: "200K", tokens: 200_000 },
  { label: "262K", tokens: 262_144 },
  { label: "1M", tokens: 1_000_000 },
] as const;

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

const ALL_CATEGORIES: ContextCategory[] = [
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
];

const SEVERITY_ORDER: ContextSeverity[] = ["ok", "notice", "warn", "critical"];

export function maxSeverity(a: ContextSeverity, b: ContextSeverity): ContextSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export function severityForShare(
  sharePercent: number,
  thresholds: ContextThresholds = DEFAULT_CONTEXT_THRESHOLDS,
): ContextSeverity {
  if (sharePercent >= thresholds.criticalPercent) return "critical";
  if (sharePercent >= thresholds.warnPercent) return "warn";
  if (sharePercent >= thresholds.noticePercent) return "notice";
  return "ok";
}

export interface EvaluateContextInput {
  provider: string;
  windowTokens: number;
  scan: ContextGraphScanResult;
  scannedAt: string;
  thresholds?: ContextThresholds;
  /**
   * Weight Otto knows exactly because it composes it — MCP tool schemas,
   * personality/team prompts, injected tools. Merged into the category totals
   * without needing a file on disk.
   */
  runtimeTokensByCategory?: Partial<Record<ContextCategory, number>>;
}

export function evaluateContext(input: EvaluateContextInput): ContextReport {
  const thresholds = input.thresholds ?? DEFAULT_CONTEXT_THRESHOLDS;
  const windowTokens = Math.max(1, input.windowTokens);

  const fixedByCategory = new Map<ContextCategory, number>();
  let conditionalTotal = 0;
  let referencedTotal = 0;

  for (const node of input.scan.nodes) {
    if (node.costClass === "conditional") {
      conditionalTotal += node.estTokens;
      continue;
    }
    if (node.costClass === "referenced") {
      referencedTotal += node.estTokens;
      continue;
    }
    fixedByCategory.set(node.category, (fixedByCategory.get(node.category) ?? 0) + node.estTokens);
  }

  for (const [category, tokens] of Object.entries(input.runtimeTokensByCategory ?? {})) {
    if (!tokens) continue;
    const key = category as ContextCategory;
    fixedByCategory.set(key, (fixedByCategory.get(key) ?? 0) + tokens);
  }

  const categoryTotals: ContextCategoryTotal[] = ALL_CATEGORIES.filter(
    (category) => (fixedByCategory.get(category) ?? 0) > 0,
  ).map((category) => {
    const estTokens = fixedByCategory.get(category) ?? 0;
    const sharePercent = toShare(estTokens, windowTokens);
    return {
      category,
      estTokens,
      sharePercent,
      severity: severityForShare(sharePercent, thresholds),
    };
  });

  const fixedTotal = categoryTotals.reduce((sum, total) => sum + total.estTokens, 0);
  const aggregateShare = toShare(fixedTotal, windowTokens);
  // Overflowing the window is not "very expensive", it is broken — requests
  // will fail or silently truncate. That is the one true red.
  const aggregateSeverity =
    fixedTotal >= windowTokens
      ? "critical"
      : categoryTotals.reduce<ContextSeverity>(
          (worst, total) => maxSeverity(worst, total.severity),
          severityForShare(aggregateShare, thresholds),
        );

  return {
    provider: input.provider,
    windowTokens,
    scannedAt: input.scannedAt,
    confidence: input.scan.confidence,
    nodes: input.scan.nodes,
    edges: input.scan.edges,
    categoryTotals,
    fixedTotal,
    conditionalTotal,
    referencedTotal,
    workingRoom: Math.max(0, windowTokens - fixedTotal),
    aggregateSeverity,
    findings: input.scan.findings,
  };
}

function toShare(tokens: number, windowTokens: number): number {
  return Math.round((tokens / windowTokens) * 1000) / 10;
}
