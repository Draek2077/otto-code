// OTTO PATCH (OTTO-PATCHES.md): absence is distinct from a provider-reported zero.
export function reportedCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function summarizeReportedCost(agents: Iterable<{ costUsd?: unknown }>, retiredCost?: unknown) {
  const retired = reportedCost(retiredCost)
  let sum = retired ?? 0
  // The historical retired accumulator starts at zero without reporting coverage.
  let priced = retired !== null && retired > 0 ? 1 : 0
  let unpriced = 0
  for (const agent of agents) {
    const value = reportedCost(agent.costUsd)
    if (value === null) unpriced++
    else { sum += value; priced++ }
  }
  return { totalCostUsd: priced > 0 ? sum : null, costIsPartial: priced > 0 && unpriced > 0 }
}
