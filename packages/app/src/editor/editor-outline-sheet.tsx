import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CodeSymbolLocation } from "@otto-code/client/internal/daemon-client";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useSessionStore } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

const KIND_GLYPH: Record<CodeSymbolLocation["kind"], string> = {
  function: "ƒ",
  class: "C",
  type: "T",
  variable: "v",
  property: "p",
};

export function EditorOutlineSheet({
  serverId,
  workspaceRoot,
  path,
  visible,
  onClose,
  onSelectLine,
}: {
  serverId: string;
  workspaceRoot: string;
  path: string;
  visible: boolean;
  onClose: () => void;
  onSelectLine: (line: number) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [symbols, setSymbols] = useState<CodeSymbolLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<CodeSymbolLocation>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, {
    enabled: showDesktopWebScrollbar,
  });

  useEffect(() => {
    if (!visible || !client) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const result = await client.getCodeOutline(workspaceRoot, path);
        if (active) {
          setSymbols(result);
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, path, visible, workspaceRoot]);

  const handleSelect = useCallback(
    (line: number) => {
      onSelectLine(line);
      onClose();
    },
    [onClose, onSelectLine],
  );

  const renderRow = useCallback(
    (info: ListRenderItemInfo<CodeSymbolLocation>) => (
      <OutlineRow symbol={info.item} onSelect={handleSelect} />
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback(
    (symbol: CodeSymbolLocation) => `${symbol.name}:${symbol.line}:${symbol.column}`,
    [],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="editor-outline-backdrop">
        <Pressable style={styles.panel} testID="editor-outline-panel">
          <Text style={styles.title}>{t("codeOutline.title")}</Text>
          <OutlineBody
            error={error}
            loadingEmpty={loading && symbols.length === 0}
            symbols={symbols}
            renderRow={renderRow}
            keyExtractor={keyExtractor}
            listRef={listRef}
            scrollbar={scrollbar}
            showDesktopWebScrollbar={showDesktopWebScrollbar}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OutlineBody({
  error,
  loadingEmpty,
  symbols,
  renderRow,
  keyExtractor,
  listRef,
  scrollbar,
  showDesktopWebScrollbar,
}: {
  error: string | null;
  loadingEmpty: boolean;
  symbols: CodeSymbolLocation[];
  renderRow: (info: ListRenderItemInfo<CodeSymbolLocation>) => ReactElement;
  keyExtractor: (symbol: CodeSymbolLocation) => string;
  listRef: RefObject<FlatList<CodeSymbolLocation> | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showDesktopWebScrollbar: boolean;
}) {
  const { t } = useTranslation();
  if (error) {
    return <Text style={styles.errorText}>{error}</Text>;
  }
  if (loadingEmpty) {
    return <Text style={styles.mutedText}>{t("editor.loading")}</Text>;
  }
  if (symbols.length === 0) {
    return <Text style={styles.mutedText}>{t("codeOutline.empty")}</Text>;
  }
  return (
    <View style={styles.listContainer}>
      <FlatList
        ref={listRef}
        data={symbols}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        style={styles.list}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        testID="editor-outline-results"
      />
      {scrollbar.overlay}
    </View>
  );
}

function OutlineRow({
  symbol,
  onSelect,
}: {
  symbol: CodeSymbolLocation;
  onSelect: (line: number) => void;
}) {
  const handlePress = useCallback(() => onSelect(symbol.line), [onSelect, symbol.line]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      testID={`editor-outline-symbol-${symbol.name}`}
      accessibilityRole="button"
    >
      <Text style={styles.glyph} dataSet={CODE_SURFACE_DATASET}>
        {KIND_GLYPH[symbol.kind]}
      </Text>
      <Text style={styles.symbolName} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
        {symbol.name}
      </Text>
      <Text style={styles.symbolLine}>{symbol.line}</Text>
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
    maxWidth: 520,
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
  symbolName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  symbolLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
}));
