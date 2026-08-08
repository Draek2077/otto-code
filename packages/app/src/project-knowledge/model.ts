import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";

type Record = ProjectKnowledgeListResponseMessage["payload"]["records"][number];

export interface ProjectKnowledgeSummary {
  projects: number;
  projectsComplete: number;
  projectsInFlight: number;
  measuredCompleted: number;
  measuredTotal: number;
  measuredPercentage: number | null;
  references: number;
  referencesAdopted: number;
  referencesRejected: number;
}

export function summarizeProjectKnowledge(records: readonly Record[]): ProjectKnowledgeSummary {
  const active = records.filter((record) => record.status === "confirmed");
  const projects = active.filter((record) => record.kind === "project");
  const references = active.filter((record) => record.kind === "reference");
  const measuredCompleted = projects.reduce(
    (total, record) => total + (record.progress?.completed ?? 0),
    0,
  );
  const measuredTotal = projects.reduce(
    (total, record) => total + (record.progress?.total ?? 0),
    0,
  );
  return {
    projects: projects.length,
    projectsComplete: projects.filter((record) => record.deliveryStatus === "complete").length,
    projectsInFlight: projects.filter((record) =>
      ["in_build", "partial", "blocked"].includes(record.deliveryStatus ?? ""),
    ).length,
    measuredCompleted,
    measuredTotal,
    measuredPercentage:
      measuredTotal > 0 ? Math.round((measuredCompleted / measuredTotal) * 100) : null,
    references: references.length,
    referencesAdopted: references.filter((record) => record.referenceDisposition === "adopted")
      .length,
    referencesRejected: references.filter((record) => record.referenceDisposition === "rejected")
      .length,
  };
}

export function formatDeliveryStatus(status: string | undefined): string {
  return (status ?? "charter").replaceAll("_", " ");
}
