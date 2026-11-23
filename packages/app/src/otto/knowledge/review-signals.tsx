import { useCallback } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readKnowledgeReviewSignals,
  type KnowledgeRecord,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { useFetchQuery } from "@/data/query";
import { SettingsRow } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Mounted only while the article's existing Review signals section is open. */
export function KnowledgeReviewSignals({
  scope,
  page,
  active,
}: {
  scope: KnowledgeScope;
  page: KnowledgeRecord;
  active: boolean;
}) {
  const read = useRpc(readKnowledgeReviewSignals);
  const report = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    retry: false,
    enabled: active,
    queryKey: [
      "ottoKnowledge",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "reviewSignals",
      page.kind,
      page.id,
      page.revision,
    ],
    queryFn: async () => {
      const result = await read({
        scope,
        kind: page.kind,
        id: page.id,
        expectedRevision: page.revision,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch } = report;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);
  if (report.error) return <Alert variant="error" description={report.error.message} />;
  if (report.isFetching || !report.data) return <SettingsRow label="Checking review signals..." />;
  const data = report.data;
  if (!data.eligible) return <SettingsRow label="Review signals apply to confirmed records." />;
  return (
    <View testID="knowledge-review-signals">
      {data.identicalTagSets ? (
        <SettingsRow label={`• Identical complete tag sets: ${data.identicalTagSets}`} />
      ) : null}
      {data.partialTagOverlap ? (
        <SettingsRow label={`• Partial tag overlap: ${data.partialTagOverlap}`} />
      ) : null}
      {data.overlappingTruth ? (
        <SettingsRow label={`• Overlapping current truth: ${data.overlappingTruth}`} />
      ) : null}
      {data.stale ? (
        <SettingsRow label={`• Stale review: 1 (last changed ${data.ageDays} days ago)`} />
      ) : null}
      {!data.identicalTagSets &&
      !data.partialTagOverlap &&
      !data.overlappingTruth &&
      !data.stale ? (
        <SettingsRow label="No review signals." />
      ) : null}
      <SettingsRow label="Read-only diagnostics">
        <Button variant="outline" size="sm" onPress={refresh} disabled={!active}>
          Refresh signals
        </Button>
      </SettingsRow>
    </View>
  );
}
