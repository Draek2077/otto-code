import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";
import { formatTokens } from "./format";
import { confirmDialog } from "@/utils/confirm-dialog";

export function ProjectKnowledgeList({
  view,
  loading,
  error,
  onSetStatus,
}: {
  view: ProjectKnowledgeListResponseMessage["payload"] | null;
  loading: boolean;
  error: string | null;
  onSetStatus: (
    id: string,
    status: "proposed" | "confirmed" | "superseded",
  ) => Promise<string | null>;
}): ReactElement {
  const [filter, setFilter] = useState<"all" | "proposed" | "confirmed" | "superseded">("all");
  const records = useMemo(
    () => view?.records.filter((record) => filter === "all" || record.status === filter) ?? [],
    [filter, view],
  );
  if (loading && !view)
    return (
      <View style={styles.empty}>
        <LoadingSpinner size="small" />
        <Text style={styles.muted}>Loading project knowledge…</Text>
      </View>
    );
  if (error)
    return (
      <View style={styles.empty}>
        <Text style={styles.muted}>{error}</Text>
      </View>
    );
  const changeStatus = async (id: string, status: "confirmed" | "superseded") => {
    const accepted = await confirmDialog({
      title: status === "confirmed" ? "Confirm project knowledge?" : "Supersede project knowledge?",
      message:
        status === "confirmed"
          ? "This adds the reviewed record to the catalog in future chats."
          : "This retains the record as history and removes it from future catalogs.",
      confirmLabel: status === "confirmed" ? "Confirm" : "Supersede",
      destructive: status === "superseded",
    });
    if (accepted) await onSetStatus(id, status);
  };
  return (
    <ScrollView contentContainerStyle={styles.list} testID="project-knowledge-list">
      <View style={styles.brief}>
        <Text style={styles.heading}>Injected brief · {formatTokens(view?.briefTokens ?? 0)}</Text>
        <Text style={styles.briefText}>
          {view?.brief || "No confirmed project knowledge is injected."}
        </Text>
        <Text style={styles.muted}>
          Included {view?.includedIds.length ?? 0}; omitted {view?.omittedCount ?? 0}
        </Text>
      </View>
      <View style={styles.filters}>
        {(["all", "proposed", "confirmed", "superseded"] as const).map((status) => (
          <Pressable
            key={status}
            // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
            onPress={() => setFilter(status)}
            style={filter === status ? styles.activeFilter : styles.filter}
          >
            <Text>{status}</Text>
          </Pressable>
        ))}
      </View>
      {records.map((record) => (
        <View key={record.id} style={styles.record}>
          <Text style={styles.heading}>
            {record.kind} · {record.status}
          </Text>
          <Text style={styles.title}>{record.title}</Text>
          {record.kind === "project" ? (
            <Text style={styles.muted}>
              Delivery: {(record.deliveryStatus ?? "charter").replaceAll("_", " ")}
              {record.progress
                ? ` · ${record.progress.completed}/${record.progress.total} ${record.progress.unit} (${Math.round((record.progress.completed / record.progress.total) * 100)}%)`
                : " · progress not measured"}
            </Text>
          ) : null}
          {record.kind === "reference" ? (
            <Text style={styles.muted}>
              Evaluation: {record.referenceDisposition ?? "unevaluated"}
              {record.sourceUrl ? ` · ${record.sourceUrl}` : ""}
            </Text>
          ) : null}
          <Text>{record.statement}</Text>
          {record.evidence ? <Text style={styles.muted}>Evidence: {record.evidence}</Text> : null}
          <Text style={styles.muted}>
            {record.tags.join(", ") || "No tags"} · Updated{" "}
            {new Date(record.updatedAt).toLocaleDateString()}
          </Text>
          {view?.findings
            .filter(
              (finding) => finding.recordId === record.id || finding.relatedRecordId === record.id,
            )
            .map((finding) => (
              <Text key={`${finding.kind}-${finding.relatedRecordId ?? ""}`} style={styles.warning}>
                {finding.message}
              </Text>
            ))}
          <View style={styles.actions}>
            {record.status !== "confirmed" ? (
              <Pressable
                // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
                onPress={() => void changeStatus(record.id, "confirmed")}
              >
                <Text style={styles.action}>Confirm…</Text>
              </Pressable>
            ) : null}
            {record.status !== "superseded" ? (
              <Pressable
                // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
                onPress={() => void changeStatus(record.id, "superseded")}
              >
                <Text style={styles.action}>Supersede…</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create((theme) => ({
  list: { padding: theme.spacing[3], gap: theme.spacing[2] },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[2] },
  brief: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
  },
  briefText: {},
  heading: { fontWeight: "600" },
  title: { fontWeight: "600", fontSize: theme.fontSize.base },
  muted: { color: theme.colors.mutedForeground },
  warning: { color: theme.colors.statusWarning },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  filter: { padding: theme.spacing[1] },
  activeFilter: {
    padding: theme.spacing[1],
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
  },
  record: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  actions: { flexDirection: "row", gap: theme.spacing[3] },
  action: { color: theme.colors.accent },
}));
