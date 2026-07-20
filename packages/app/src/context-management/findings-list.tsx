import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextFinding, ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { ChevronRight } from "@/components/icons/material-icons";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { ScopeIcon, SCOPE_ICON_SIZE } from "./scope-icon";

// Theme-reactive icon color without useUnistyles (docs/unistyles.md).
const ThemedChevronRight = withUnistyles(ChevronRight);

const ARROW_ICON_SIZE = 16;

/** What a row hands back: the file to open, and the finding that sent you there. */
export interface ContextFindingTarget {
  node: ContextNode;
  finding: ContextFinding;
}

interface ContextFindingsListProps {
  report: ContextReport | null;
  /** First scan, nothing to show yet — "nothing worth fixing" would be a lie. */
  isLoading: boolean;
  onReveal: (target: ContextFindingTarget) => void;
}

/**
 * The fix list. A finding is only actionable if you can tell what it is about,
 * so every row names its own file and line and carries a right arrow that takes
 * you there: the file opens at the line, the Context tree reveals and selects
 * the same file, and the finding restates itself above the editor.
 *
 * The file comes from the finding's own `nodeId`, not from `relatedNodeIds` —
 * the related list is the *other* half of a duplicate, which is the one thing
 * the row must not be confused with.
 */
export function ContextFindingsList({
  report,
  isLoading,
  onReveal,
}: ContextFindingsListProps): ReactElement {
  const { t } = useTranslation();
  const findings = report?.findings ?? [];

  const listRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: isWeb });

  if (findings.length === 0) {
    return (
      <View style={styles.empty}>
        {isLoading ? (
          <View style={styles.loadingRow} testID="context-findings-loading">
            <ActivityIndicator size="small" />
            <Text style={styles.emptyText}>{t("contextManagement.findings.loading")}</Text>
          </View>
        ) : (
          <Text style={styles.emptyText}>{t("contextManagement.findings.empty")}</Text>
        )}
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
        {findings.map((finding, index) => (
          <FindingRow
            key={`${finding.kind}:${finding.nodeId ?? ""}:${finding.line ?? index}:${finding.message}`}
            finding={finding}
            report={report}
            onReveal={onReveal}
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
  onReveal: (target: ContextFindingTarget) => void;
}

function FindingRow({ finding, report, onReveal }: FindingRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);

  // `nodeId` is the file the finding lives in. Reports from before it existed
  // still carry `relatedNodeIds`, which at least lands you somewhere true.
  const owner = useMemo(() => {
    if (!report) return null;
    const id = finding.nodeId ?? finding.relatedNodeIds?.[0];
    if (!id) return null;
    return report.nodes.find((node) => node.id === id) ?? null;
  }, [finding.nodeId, finding.relatedNodeIds, report]);

  const handlePress = useCallback(() => {
    if (owner) onReveal({ node: owner, finding });
  }, [finding, onReveal, owner]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const location = owner ? formatLocation(owner, finding.line) : null;
  // Hover is a web-only affordance, so touch and compact keep the arrow on
  // permanently — there it is the only sign the row goes anywhere (docs/hover.md).
  const showArrow = Boolean(owner) && (isHovered || isNative || isCompact);

  return (
    // Hover tracks on a plain View, never on the Pressable — the canonical
    // shape from docs/hover.md, kept even though this row has no nested
    // Pressable today, because the day one appears is the day it breaks.
    <View
      style={styles.rowHoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole={owner ? "button" : "text"}
        accessibilityLabel={
          owner ? t("contextManagement.findings.reveal", { location }) : finding.message
        }
        disabled={!owner}
        onPress={handlePress}
        style={styles.row}
        testID={`context-finding-${finding.kind}`}
      >
        {/* Scope, not severity. Every row here is already "worth fixing"; the
            open question is how far the fix reaches — a global file is every
            project on the machine, a project file is only this one. Same icon
            vocabulary as the tree, so a file and a finding about it match. */}
        <View style={styles.scope}>
          {owner ? <ScopeIcon scope={owner.scope} showProject /> : null}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.message}>{finding.message}</Text>
          {location ? (
            <Text style={styles.target} numberOfLines={1}>
              {location}
            </Text>
          ) : null}
        </View>
        {/* Decoration, not a second target: the whole row already goes there,
            and a nested Pressable would only give the arrow a smaller hit area.
            It fades rather than mounts, so revealing it never reflows the text
            under the cursor and flickers the hover it depends on. */}
        {owner ? (
          <View style={showArrow ? styles.arrow : styles.arrowHidden} pointerEvents="none">
            <ThemedChevronRight size={ARROW_ICON_SIZE} uniProps={arrowIconColor} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const arrowIconColor = (theme: Theme) => ({ color: theme.colors.mutedForeground });

/** `path/to/file.md:42` — the form every editor and terminal already uses. */
function formatLocation(node: ContextNode, line: number | undefined): string {
  return line != null ? `${node.relPath}:${line}` : node.relPath;
}

// Part of Context Management's compact first screen, so every font takes the +2
// compact bump (docs convention; `md` and up stay put).
function bump(size: number) {
  return { xs: size + 2, md: size };
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
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.mutedForeground,
    fontSize: bump(theme.fontSize.sm),
  },
  // Nothing but a bounding box to hover; all layout lives on the Pressable.
  rowHoverTarget: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  // Fixed slot so rows stay aligned when a finding has no file to scope.
  scope: {
    width: SCOPE_ICON_SIZE,
    alignSelf: "flex-start",
    alignItems: "center",
    marginTop: 3,
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  message: {
    color: theme.colors.foreground,
    fontSize: bump(theme.fontSize.sm),
  },
  target: {
    color: theme.colors.mutedForeground,
    fontSize: bump(theme.fontSize.xs),
  },
  arrow: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Same box, invisible: the slot is always in the layout so the message text
  // never re-wraps when the arrow appears.
  arrowHidden: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
  },
}));
