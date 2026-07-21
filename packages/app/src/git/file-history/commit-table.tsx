import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { GitFileHistoryEntry } from "@otto-code/protocol/messages";
import { Button } from "@/components/ui/button";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { compactFont, compactUp } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";
import {
  COLUMN_WIDTH_AUTHOR,
  COLUMN_WIDTH_DATE,
  COLUMN_WIDTH_SHA,
  TABLE_COMPACT_SCALE,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
} from "./table-geometry";

/**
 * The commit list, as a table: sha, date, author, subject in fixed columns
 * under a pinned header. A developer scans this vertically — down the author
 * column to find their own commits, down the date column to find last Tuesday —
 * which only works if the columns hold their edges.
 */

export interface CommitTableProps {
  entries: GitFileHistoryEntry[];
  selectedSha: string | null;
  onSelect: (entry: GitFileHistoryEntry) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function CommitTableHeader() {
  const { t } = useTranslation();
  return (
    <View style={styles.headerRow}>
      <Text style={styles.headerShaCell} numberOfLines={1}>
        {t("gitFileHistory.columns.version")}
      </Text>
      <Text style={styles.headerDateCell} numberOfLines={1}>
        {t("gitFileHistory.columns.date")}
      </Text>
      <Text style={styles.headerAuthorCell} numberOfLines={1}>
        {t("gitFileHistory.columns.author")}
      </Text>
      <Text style={styles.headerMessageCell} numberOfLines={1}>
        {t("gitFileHistory.columns.message")}
      </Text>
    </View>
  );
}

export function CommitTable({
  entries,
  selectedSha,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: CommitTableProps) {
  const { t } = useTranslation();
  return (
    <View>
      {entries.map((entry) => (
        <CommitRow
          key={entry.sha}
          entry={entry}
          selected={entry.sha === selectedSha}
          onSelect={onSelect}
        />
      ))}
      {hasMore ? (
        <View style={styles.loadMoreRow}>
          <Button
            size="xs"
            variant="ghost"
            loading={loadingMore}
            onPress={onLoadMore}
            testID="file-history-load-more"
          >
            {t("gitFileHistory.loadMore")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function CommitRow({
  entry,
  selected,
  onSelect,
}: {
  entry: GitFileHistoryEntry;
  selected: boolean;
  onSelect: (entry: GitFileHistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyleFor(selected)}
      accessibilityRole="button"
      testID={`file-history-commit-${entry.shortSha}`}
    >
      <Text style={styles.shaCell} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
        {entry.shortSha}
      </Text>
      <Text style={styles.dateCell} numberOfLines={1}>
        {formatTimeAgo(new Date(entry.authoredAt * 1000))}
      </Text>
      <Text style={styles.authorCell} numberOfLines={1}>
        {entry.authorName}
      </Text>
      <View style={styles.messageCell}>
        <Text style={styles.messageText} numberOfLines={1}>
          {entry.subject}
        </Text>
        {/* Renames and merges are the two things that make a history confusing
            to read; label them in the row rather than making the reader open
            the commit to find out why the path jumped. */}
        {entry.previousPath ? (
          <Text style={styles.tag} numberOfLines={1}>
            {t("gitFileHistory.renamed")}
          </Text>
        ) : null}
        {entry.isMerge ? (
          <Text style={styles.tag} numberOfLines={1}>
            {t("gitFileHistory.merge")}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function rowStyleFor(selected: boolean) {
  return ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
    styles.row,
    (Boolean(hovered) || pressed) && !selected && styles.rowHovered,
    selected && styles.rowSelected,
  ];
}

const styles = StyleSheet.create((theme) => ({
  // The header carries the same horizontal padding as a row so its labels sit
  // directly above the values they name.
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    height: compactUp(TABLE_HEADER_HEIGHT, TABLE_COMPACT_SCALE),
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  headerShaCell: {
    width: COLUMN_WIDTH_SHA,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  headerDateCell: {
    width: COLUMN_WIDTH_DATE,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  headerAuthorCell: {
    width: COLUMN_WIDTH_AUTHOR,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  headerMessageCell: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  // Full-bleed row: selection paints edge to edge like a real list, so the
  // selected commit reads as one band rather than a floating chip.
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: compactUp(TABLE_ROW_HEIGHT, TABLE_COMPACT_SCALE),
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  shaCell: {
    width: COLUMN_WIDTH_SHA,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontFamily: theme.fontFamily.mono,
  },
  dateCell: {
    width: COLUMN_WIDTH_DATE,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  authorCell: {
    width: COLUMN_WIDTH_AUTHOR,
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
  },
  messageCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  messageText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
  },
  tag: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(10),
    lineHeight: compactFont(14, 3),
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
  },
  loadMoreRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
}));
