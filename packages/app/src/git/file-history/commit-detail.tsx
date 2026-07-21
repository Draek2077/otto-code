import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { GitFileHistoryEntry } from "@otto-code/protocol/messages";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { compactFont } from "@/styles/theme";

/**
 * The selected commit's full message, pinned along the bottom of the pane.
 *
 * The commit table can only show a subject truncated to one line, and the body
 * is where the reasoning lives — the "why" that makes a diff make sense. The
 * daemon already sends it; not rendering it anywhere was throwing away the most
 * valuable text in the response.
 *
 * Its own resizable pane with its own scroll: how much room a commit message
 * deserves depends entirely on the repo you are reading, and a fixed height
 * either wastes the screen or truncates the paragraph that explains the change.
 */

export interface CommitDetailProps {
  entry: GitFileHistoryEntry | null;
}

export function CommitDetail({ entry }: CommitDetailProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  // Not gated on form factor: a narrow browser window still draws the platform's
  // dated bar, so compact web needs the overlay every bit as much as desktop.
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });
  if (!entry) {
    return null;
  }
  const authoredAt = new Date(entry.authoredAt * 1000);
  return (
    <View style={styles.container} testID="file-history-commit-detail">
      <View style={styles.metaRow}>
        <Text style={styles.sha} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
          {entry.shortSha}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {entry.authorName}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {entry.authorEmail}
        </Text>
        <Text style={styles.date} numberOfLines={1}>
          {authoredAt.toLocaleString()}
        </Text>
        {/* Say the rename in words. The diff header shows the two paths, but
            this is the line someone copies into a review comment. */}
        {entry.previousPath ? (
          <Text style={styles.rename} numberOfLines={1}>
            {t("gitFileHistory.renamedFrom", { path: entry.previousPath })}
          </Text>
        ) : null}
      </View>
      <View style={styles.messageScrollHost}>
        <ScrollView
          ref={scrollRef}
          style={styles.messageScroll}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!isWeb}
          nestedScrollEnabled
        >
          <Text style={styles.subject} selectable>
            {entry.subject}
          </Text>
          {entry.body ? (
            <Text style={styles.body} selectable>
              {entry.body}
            </Text>
          ) : null}
        </ScrollView>
        {scrollbar.overlay}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // No top border: the splitter above already draws the dividing line, and two
  // hairlines a pixel apart read as a rendering fault.
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  sha: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    fontFamily: theme.fontFamily.mono,
  },
  author: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  email: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  date: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  rename: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontStyle: "italic",
  },
  messageScrollHost: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  messageScroll: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  subject: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
  },
  body: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    lineHeight: compactFont(18, 3),
  },
}));
