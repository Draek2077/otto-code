import { i18n } from "@/i18n/i18next";

export interface CompactionMarkerLabelInput {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
  shortSummary?: string;
}

export function getCompactionMarkerLabel({
  status,
  trigger,
  preTokens,
  shortSummary,
}: CompactionMarkerLabelInput): string {
  if (status === "loading") return i18n.t("message.compaction.loading");
  // A provider-supplied PR-style summary is more useful than the generic label.
  if (shortSummary && shortSummary.trim().length > 0) return shortSummary.trim();
  if (trigger === "auto") return i18n.t("message.compaction.auto");
  if (trigger === "manual") return i18n.t("message.compaction.manual");
  if (preTokens) {
    return i18n.t("message.compaction.withTokens", {
      tokens: Math.round(preTokens / 1000),
    });
  }
  return i18n.t("message.compaction.completed");
}
