import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";

type Record = ProjectKnowledgeListResponseMessage["payload"]["records"][number];

export type KnowledgeArticleKind = Exclude<Record["kind"], "project" | "reference">;

export const KNOWLEDGE_ARTICLE_KINDS = [
  "architecture",
  "decision",
  "constraint",
  "requirement",
  "finding",
] as const satisfies readonly KnowledgeArticleKind[];

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

/** A record matches when it carries every selected tag (case-insensitive). */
export function recordMatchesTags(
  record: { tags: readonly string[] },
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  const owned = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return selected.every((tag) => owned.has(tag.toLowerCase()));
}

/** Knowledge articles match any chosen type; the picker never permits an empty selection. */
export function recordMatchesKnowledgeTypes(
  record: { kind: string },
  selected: readonly KnowledgeArticleKind[],
): boolean {
  return selected.includes(record.kind as KnowledgeArticleKind);
}

/** Choosing All restores every article type; clearing the final type does the same. */
export function toggleKnowledgeTypeFilter(
  selected: readonly KnowledgeArticleKind[],
  kind: KnowledgeArticleKind | "all",
): KnowledgeArticleKind[] {
  if (kind === "all") return [...KNOWLEDGE_ARTICLE_KINDS];
  const next = selected.includes(kind)
    ? selected.filter((value) => value !== kind)
    : [...selected, kind];
  return next.length > 0 ? next : [...KNOWLEDGE_ARTICLE_KINDS];
}

/** Alternate selection makes one type the complete filter. */
export function isolateKnowledgeTypeFilter(kind: KnowledgeArticleKind): KnowledgeArticleKind[] {
  return [kind];
}

/** Distinct tags across records, deduped case-insensitively in stable order. */
export function uniqueTags(records: readonly { tags: readonly string[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const record of records) {
    for (const tag of record.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function formatDeliveryStatus(status: string | undefined): string {
  return formatMetadataLabel(status ?? "charter");
}

/** Stored metadata stays machine-readable; only its presentation is polished. */
export function formatMetadataLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}
