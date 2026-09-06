export const ARCHITECTURAL_VIEW_DIAGRAM_TYPES = [
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "lifecycle",
] as const;

export type ArchitecturalViewDiagramType = (typeof ARCHITECTURAL_VIEW_DIAGRAM_TYPES)[number];

export interface ArchitecturalViewTypeSuggestion {
  diagramType: ArchitecturalViewDiagramType;
  evidence: string;
}

export function architecturalViewTypeLabel(type: ArchitecturalViewDiagramType): string {
  switch (type) {
    case "architecture":
      return "Architecture";
    case "workflow":
      return "Workflow";
    case "sequence":
      return "Sequence";
    case "dataflow":
      return "Data Flow";
    case "lifecycle":
      return "Lifecycle";
  }
}

/**
 * A cheap, explainable first pass over the one linked Knowledge article.
 * We only make a suggestion when the source is unambiguous; the user always
 * retains the five explicit choices in the create menu.
 */
export function detectArchitecturalViewType(input: {
  title: string;
  markdown: string;
}): ArchitecturalViewTypeSuggestion | null {
  const source = `${input.title}\n${input.markdown}`;
  if (/^\s*sequenceDiagram\b/im.test(source)) {
    return { diagramType: "sequence", evidence: "Detected a Mermaid sequence diagram" };
  }
  if (/^\s*stateDiagram(?:-v2)?\b/im.test(source)) {
    return { diagramType: "lifecycle", evidence: "Detected a Mermaid state diagram" };
  }

  const scores: Record<ArchitecturalViewDiagramType, number> = {
    architecture: score(source, ["component", "service", "storage", "boundary", "deployment"]),
    workflow: score(source, ["ci/cd", "approval", "runbook", "workflow", "deploy", "rollback"]),
    sequence: score(source, ["request", "response", "cache", "auth", "async", "caller"]),
    dataflow: score(source, ["lineage", "pii", "source", "transform", "consumer", "pipeline"]),
    lifecycle: score(source, ["state", "retry", "cancel", "waiting", "terminal", "lifecycle"]),
  };
  const ranked = ARCHITECTURAL_VIEW_DIAGRAM_TYPES.map((diagramType) => ({
    diagramType,
    score: scores[diagramType],
  })).sort((left, right) => right.score - left.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner || winner.score < 2 || winner.score <= (runnerUp?.score ?? 0)) return null;
  return {
    diagramType: winner.diagramType,
    evidence: `Detected ${architecturalViewTypeLabel(winner.diagramType).toLowerCase()} terminology`,
  };
}

function score(source: string, terms: readonly string[]): number {
  return terms.reduce(
    (total, term) =>
      total + (source.match(new RegExp(`\\b${term.replace("/", "\\/")}\\b`, "gi"))?.length ?? 0),
    0,
  );
}
