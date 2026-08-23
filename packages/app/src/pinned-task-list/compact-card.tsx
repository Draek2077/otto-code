import { useCallback, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, X } from "@/components/icons/material-icons";
import {
  TodoSummaryMarker,
  TodoTaskList,
  TodoTaskListProgress,
  useTodoCounts,
} from "@/components/todo-task-list";
import type { Theme } from "@/styles/theme";
import type { TodoListStreamItem } from "./select";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedX = withUnistyles(X);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Shorter than the desktop cap: on a phone this card floats over the transcript,
// and anything taller buries the conversation it is meant to annotate.
const COMPACT_LIST_MAX_HEIGHT = 240;

// Hoisted so the accessibility object is not a fresh literal every render.
const EXPANDED_STATE = { expanded: true } as const;
const COLLAPSED_STATE = { expanded: false } as const;

export interface CompactPinnedTaskListCardProps {
  item: TodoListStreamItem;
  animationsEnabled: boolean;
  onDismiss: () => void;
}

/**
 * The shared checklist form: one row deep until the user asks for more. The
 * progress bar stays at the top even while collapsed, while the summary row
 * carries done/total plus a phase glyph. Tapping the row opens the task detail
 * only when the user wants it, on desktop and compact screens alike.
 */
export function CompactPinnedTaskListCard({
  item,
  animationsEnabled,
  onDismiss,
}: CompactPinnedTaskListCardProps): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { completedCount, total, phase } = useTodoCounts(item.items);

  const toggle = useCallback(() => {
    setExpanded((previous) => !previous);
  }, []);

  const title = t("message.todo.title");
  const progress = t("message.todo.progress", { completed: completedCount, total });

  return (
    <>
      <View style={styles.header}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={expanded ? EXPANDED_STATE : COLLAPSED_STATE}
            accessibilityLabel={total > 0 ? `${title} ${progress}` : title}
            testID="pinned-task-list-compact-toggle"
            onPress={toggle}
            style={styles.toggle}
          >
            {expanded ? (
              <ThemedChevronDown size="md" uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedChevronRight size="md" uniProps={foregroundMutedColorMapping} />
            )}
            <TodoSummaryMarker phase={phase} animationsEnabled={animationsEnabled} />
            <Text style={styles.label} numberOfLines={1}>
              {title}
            </Text>
            {total > 0 ? <Text style={styles.count}>{progress}</Text> : null}
            <View style={styles.spacer} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("message.todo.dismiss")}
            testID="pinned-task-list-overlay-dismiss"
            onPress={onDismiss}
            style={styles.dismiss}
            hitSlop={8}
          >
            <ThemedX size="md" uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
        <TodoTaskListProgress items={item.items} animationsEnabled={animationsEnabled} />
      </View>
      {expanded ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <TodoTaskList
            items={item.items}
            animationsEnabled={animationsEnabled}
            emptyLabel=""
            showProgress={false}
          />
        </ScrollView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The header owns both the always-visible summary and its progress rail. The
  // detail list begins only below the divider, so collapsing never hides the
  // work-state visual.
  header: {
    paddingTop: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Takes the whole row bar the dismiss button, so the press target for
  // expanding is everything the thumb is likely to land on.
  toggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
  },
  count: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  dismiss: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  list: {
    maxHeight: COMPACT_LIST_MAX_HEIGHT,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  listContent: {
    paddingTop: theme.spacing[2],
  },
}));
