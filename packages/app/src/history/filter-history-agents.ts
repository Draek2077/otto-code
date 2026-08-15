import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

function normalizeSearchTerm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Filters History by the conversation metadata presented in its rows. */
export function filterHistoryAgents(
  agents: readonly AggregatedAgent[],
  searchTerm: string,
): AggregatedAgent[] {
  const normalizedSearchTerm = normalizeSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return [...agents];
  }

  return agents.filter((agent) => {
    const projectPlacement = agent.projectPlacement;
    const searchableText = [
      agent.title,
      agent.serverLabel,
      projectPlacement?.projectName,
      projectPlacement?.workspaceName,
      projectPlacement?.checkout.currentBranch,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .toLocaleLowerCase();

    return searchableText.includes(normalizedSearchTerm);
  });
}
