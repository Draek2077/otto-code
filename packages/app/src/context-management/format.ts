import type { ContextCategory, ContextReport, ContextSeverity } from "@otto-code/protocol/messages";

/** `14200` -> `14.2K`. Token counts are estimates; extra digits imply precision we do not have. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.round(tokens)}`;
  if (tokens < 100_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatPercent(share: number): string {
  if (share > 0 && share < 1) return "<1%";
  return `${Math.round(share)}%`;
}

export function reportSharePercent(report: ContextReport): number {
  if (report.windowTokens <= 0) return 0;
  return (report.fixedTotal / report.windowTokens) * 100;
}

/** i18n key suffix per category — the tree and the summary use the same labels. */
export const CATEGORY_LABEL_KEYS: Record<ContextCategory, string> = {
  context_files: "contextManagement.category.contextFiles",
  memory_index: "contextManagement.category.memoryIndex",
  skills_roster: "contextManagement.category.skillsRoster",
  mcp_tools: "contextManagement.category.mcpTools",
  otto_injected: "contextManagement.category.ottoInjected",
  system_prompt: "contextManagement.category.systemPrompt",
};

/**
 * Only `warn` and `critical` interrupt. `notice` is real but not worth a
 * flyout — it shows in the tab, where the user came to look anyway.
 */
export function shouldRaiseContextWarning(report: ContextReport | null): report is ContextReport {
  if (!report) return false;
  return report.aggregateSeverity === "warn" || report.aggregateSeverity === "critical";
}

export function isCriticalSeverity(severity: ContextSeverity): boolean {
  return severity === "critical";
}
