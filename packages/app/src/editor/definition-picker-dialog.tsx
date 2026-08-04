import { useCallback, useRef } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CodeSymbolLocation } from "@otto-code/client/internal/daemon-client";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

// The multi-hit half of go-to-definition. Two sources reach here and both are
// genuine ambiguity rather than a guess: the ctags index is name-based with no
// type resolution, and a language server reports real overloads and
// implementations. A single hit never reaches here; it jumps.

/**
 * A location the picker can show. `kind` is present only for ctags hits - a
 * language server answers with positions, and inventing a glyph for one would be
 * showing the user something we do not know.
 */
export interface DefinitionCandidate {
  path: string;
  line: number;
  column: number;
  kind?: CodeSymbolLocation["kind"];
  /**
   * Which source produced this row - a language server id, or the name index. Shown
   * because it changes how much the list is worth trusting: a server resolved real
   * overloads, the index only matched a name.
   */
  source?: string;
}

const KIND_GLYPH: Record<CodeSymbolLocation["kind"], string> = {
  function: "ƒ",
  class: "C",
  type: "T",
  variable: "v",
  property: "p",
};

export function DefinitionPickerDialog({
  name,
  candidates,
  onClose,
  onSelect,
}: {
  name: string;
  /** Empty means closed - the picker only ever exists with hits to show. */
  candidates: DefinitionCandidate[];
  onClose: () => void;
  onSelect: (candidate: DefinitionCandidate) => void;
}) {
  const { t } = useTranslation();
  // Ungated on compact, matching the outline sheet: the app's overlay bar is
  // wanted on mobile web too. No-ops off web.
  const showWebScrollbar = isWeb;
  const listRef = useRef<FlatList<DefinitionCandidate>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, { enabled: showWebScrollbar });

  const renderRow = useCallback(
    (info: ListRenderItemInfo<DefinitionCandidate>) => (
      <CandidateRow candidate={info.item} onSelect={onSelect} />
    ),
    [onSelect],
  );

  const keyExtractor = useCallback(
    (candidate: DefinitionCandidate) =>
      `${candidate.path}:${candidate.line}:${candidate.column}:${candidate.kind ?? ""}`,
    [],
  );

  return (
    <Modal
      visible={candidates.length > 0}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="definition-picker-backdrop">
        <Pressable style={styles.panel} testID="definition-picker-panel">
          <Text style={styles.title}>
            {/* `total`, not i18next's magic `count` key: passing `count` would
                send the lookup hunting for plural-suffixed variants this string
                does not have. The picker only ever opens with 2+ hits. */}
            {t("goToDefinition.pickerTitle", { total: candidates.length, name })}
          </Text>
          <View style={styles.listContainer}>
            <FlatList
              ref={listRef}
              data={candidates}
              renderItem={renderRow}
              keyExtractor={keyExtractor}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              onLayout={scrollbar.onLayout}
              onScroll={scrollbar.onScroll}
              onContentSizeChange={scrollbar.onContentSizeChange}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={!showWebScrollbar}
              testID="definition-picker-results"
            />
            {scrollbar.overlay}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CandidateRow({
  candidate,
  onSelect,
}: {
  candidate: DefinitionCandidate;
  onSelect: (candidate: DefinitionCandidate) => void;
}) {
  const handlePress = useCallback(() => onSelect(candidate), [candidate, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      testID={`definition-picker-result-${candidate.path}:${candidate.line}`}
      accessibilityRole="button"
    >
      <Text style={styles.glyph} dataSet={CODE_SURFACE_DATASET}>
        {candidate.kind ? KIND_GLYPH[candidate.kind] : "◆"}
      </Text>
      {/* The path is the disambiguator, so it truncates from the LEFT: the tail
          of a deep path is what tells two same-named symbols apart. */}
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
        {candidate.path}
      </Text>
      {candidate.source ? <Text style={styles.source}>{candidate.source}</Text> : null}
      <Text style={styles.line}>{candidate.line}</Text>
    </Pressable>
  );
}

function rowStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: "12%",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  panel: {
    width: "90%",
    maxWidth: 640,
    maxHeight: "70%",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    ...theme.shadow.lg,
  },
  title: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  listContainer: {
    flexGrow: 0,
    flexShrink: 1,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  glyph: {
    width: 16,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  path: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  source: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  line: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
}));
