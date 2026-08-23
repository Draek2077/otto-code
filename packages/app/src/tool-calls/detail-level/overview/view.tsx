import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Wrench } from "@/components/icons/lucide";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import { type OverviewSummary, type OverviewToolCallGroup } from "./model";
import type { ExpandAllCommand } from "@/agent-stream/view";

interface OverviewGroupProps {
  group: OverviewToolCallGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: (expandAllCommand: ExpandAllCommand | null) => ReactNode;
  expandAllCommand?: ExpandAllCommand | null;
}

const TOOL_CALL_GROUP_MAX_HEIGHT = 400;

function joinSummaryParts(parts: string[], conjunction: string): string {
  if (parts.length === 0) {
    return "";
  }
  let joined = parts[0] ?? "";
  if (parts.length === 2) {
    joined = `${parts[0]} ${conjunction} ${parts[1]}`;
  } else if (parts.length > 2) {
    joined = `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

function useOverviewSummary(summary: OverviewSummary): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const parts: string[] = [];
    const entries = [
      [summary.editedFileCount, "toolCallGroup.editedFiles"],
      [summary.commandCount, "toolCallGroup.commands"],
      [summary.readFileCount, "toolCallGroup.readFiles"],
      [summary.searchCount, "toolCallGroup.searches"],
      [summary.otherToolCount, "toolCallGroup.otherTools"],
      [summary.ottoCallCount, "toolCallGroup.ottoCalls"],
    ] as const;
    for (const [count, key] of entries) {
      if (count > 0) {
        parts.push(t(`${key}.${count === 1 ? "one" : "other"}`, { count }));
      }
    }
    return joinSummaryParts(parts, t("toolCallGroup.and"));
  }, [summary, t]);
}

export const OverviewToolCallGroupView = memo(function OverviewToolCallGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
  expandAllCommand,
}: OverviewGroupProps) {
  const scrollRef = useRef<ScrollView>(null);
  const aggregateSummary = useOverviewSummary(group.summary);
  const [childExpandAllCommand, setChildExpandAllCommand] = useState<ExpandAllCommand | null>(null);
  const effectiveExpanded = expandAllCommand?.expanded ?? expanded;
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const toggle = useCallback(() => {
    onExpandedChange(group.run.id, !effectiveExpanded);
  }, [effectiveExpanded, group.run.id, onExpandedChange]);
  const expandAll = useCallback(() => {
    setChildExpandAllCommand((current) => ({
      expanded: true,
      revision: (current?.revision ?? 0) + 1,
    }));
    onExpandedChange(group.run.id, true);
  }, [group.run.id, onExpandedChange]);
  const collapseAll = useCallback(() => {
    setChildExpandAllCommand((current) => ({
      expanded: false,
      revision: (current?.revision ?? 0) + 1,
    }));
    onExpandedChange(group.run.id, false);
  }, [group.run.id, onExpandedChange]);
  useEffect(() => {
    if (expandAllCommand) {
      setChildExpandAllCommand(expandAllCommand);
    }
  }, [expandAllCommand]);
  const renderDetails = useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        {children(childExpandAllCommand)}
      </ScrollView>
    ),
    [children, childExpandAllCommand, scrollToLatest],
  );

  return (
    <ExpandableBadge
      testID="tool-call-group"
      label={aggregateSummary}
      icon={Wrench}
      isLoading={group.isLoading}
      isExpanded={effectiveExpanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  content: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
}));
