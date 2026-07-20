import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ContextFinding, ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";

interface ContextFindingsListProps {
  report: ContextReport | null;
  onSelectNode: (node: ContextNode) => void;
}

/**
 * The fix list. Each finding names one thing worth changing, and — when the
 * scanner knows which file it came from — takes you straight there, so the tab
 * is a worklist rather than a wall of complaints.
 */
export function ContextFindingsList({
  report,
  onSelectNode,
}: ContextFindingsListProps): ReactElement {
  const { t } = useTranslation();
  const findings = report?.findings ?? [];

  const listRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: isWeb });

  if (findings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t("contextManagement.findings.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      <ScrollView
        ref={listRef}
        style={styles.list}
        testID="context-findings-list"
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
      >
        {findings.map((finding) => (
          <FindingRow
            key={`${finding.kind}:${finding.message}`}
            finding={finding}
            report={report}
            onSelectNode={onSelectNode}
          />
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

interface FindingRowProps {
  finding: ContextFinding;
  report: ContextReport | null;
  onSelectNode: (node: ContextNode) => void;
}

function FindingRow({ finding, report, onSelectNode }: FindingRowProps): ReactElement {
  const target = useMemo(() => {
    const id = finding.relatedNodeIds?.[0];
    if (!id || !report) return null;
    return report.nodes.find((node) => node.id === id) ?? null;
  }, [finding.relatedNodeIds, report]);

  const handlePress = useCallback(() => {
    if (target) onSelectNode(target);
  }, [onSelectNode, target]);

  return (
    <Pressable
      accessibilityRole={target ? "button" : "text"}
      disabled={!target}
      onPress={handlePress}
      style={styles.row}
      testID={`context-finding-${finding.kind}`}
    >
      <View style={styles.dot} />
      <View style={styles.rowBody}>
        <Text style={styles.message}>{finding.message}</Text>
        {target ? (
          <Text style={styles.target} numberOfLines={1}>
            {target.relPath}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  listWrap: {
    flex: 1,
    minHeight: 0,
  },
  list: { flex: 1 },
  empty: {
    padding: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusWarning,
    marginTop: 6,
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  message: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  target: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
}));
