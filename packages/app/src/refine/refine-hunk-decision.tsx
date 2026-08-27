import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DiffViewer } from "@/components/diff-viewer";
import { TreeChevron } from "@/components/tree-primitives";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import type { RefineHunk } from "@/refine/hunks";
import { compactFont } from "@/styles/theme";
import type { DiffPresentation } from "@/utils/diff-document";

/**
 * One independently reviewable AI change. Refine and Knowledge share this
 * control so keeping or dropping a hunk means exactly the same thing in both
 * surfaces: a folded hunk is only hidden, while a dropped hunk remains visible
 * but recedes.
 */
export function RefineHunkDecision({
  filePath,
  beforeSource,
  afterSource,
  hunk,
  ordinal,
  kept,
  onToggle,
  presentation,
  testID = "refine-hunk",
  displayLines = hunk.lines,
}: {
  filePath: string;
  beforeSource?: string;
  afterSource?: string;
  hunk: RefineHunk;
  ordinal: number;
  kept: boolean;
  onToggle: (hunkId: string) => void;
  presentation: DiffPresentation;
  testID?: string;
  /** A source-only field boundary may be hidden without changing replay semantics. */
  displayLines?: RefineHunk["lines"];
}): ReactElement {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((current) => !current), []);
  const toggleKept = useCallback(() => onToggle(hunk.id), [hunk.id, onToggle]);
  const bodyStyle = useMemo(() => [styles.body, !kept && styles.bodyDropped], [kept]);
  const document = useMemo(
    () => ({
      source: "proposal" as const,
      filePath,
      lines: displayLines,
      beforeSource,
      afterSource,
    }),
    [afterSource, beforeSource, displayLines, filePath],
  );
  const foldState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={styles.root} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={foldState}
        accessibilityLabel={t("refine.hunk.title", { ordinal })}
        onPress={toggleCollapsed}
        style={styles.header}
        testID={`${testID}-fold`}
      >
        <TreeChevron expanded={!collapsed} />
        <Text style={styles.name}>{t("refine.hunk.title", { ordinal })}</Text>
        <Text style={styles.stat}>
          +{hunk.additions} −{hunk.removals}
        </Text>
        <View style={styles.spacer} />
        <Text style={kept ? styles.kept : styles.dropped}>
          {kept ? t("refine.hunk.keeping") : t("refine.hunk.dropped")}
        </Text>
        <Switch
          value={kept}
          onValueChange={toggleKept}
          accessibilityLabel={t("refine.hunk.keepAccessibility", { ordinal })}
          testID={`${testID}-keep`}
        />
      </Pressable>
      {collapsed ? null : (
        <View style={bodyStyle}>
          <DiffViewer
            diffLines={displayLines}
            document={document}
            presentation={presentation}
            frame="top"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  name: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
  },
  stat: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  spacer: { flex: 1 },
  kept: { color: theme.colors.statusSuccess, fontSize: compactFont(theme.fontSize.sm) },
  dropped: { color: theme.colors.foregroundMuted, fontSize: compactFont(theme.fontSize.sm) },
  body: { backgroundColor: theme.colors.surfaceCode },
  bodyDropped: { opacity: 0.45 },
}));
