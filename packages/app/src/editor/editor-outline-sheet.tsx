import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CodeSymbolLocation } from "@otto-code/client/internal/daemon-client";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useSessionStore } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { extractMarkdownHeadings } from "@otto-code/highlight";
import { isMarkdownPath } from "./markdown/markdown-path";

/** Per heading level, in px. Enough to read as nesting without pushing H6 off the row. */
const HEADING_INDENT = 10;

const KIND_GLYPH: Record<CodeSymbolLocation["kind"], string> = {
  function: "ƒ",
  class: "C",
  type: "T",
  variable: "v",
  property: "p",
};

/**
 * One outline row, from either of the two sources this sheet has.
 *
 * Code symbols come from the daemon's `code.outline`; markdown headings are
 * extracted from the open buffer on the client, because a heading is not a
 * `CodeSymbolKind` and adding one would break the wire enum for older clients
 * (see markdown-headings.ts). Both are flattened into this shape so there is one
 * list, one row component, and one keyboard path.
 */
interface OutlineEntry {
  key: string;
  name: string;
  line: number;
  glyph: string;
  /** Heading nesting; always 0 for code symbols, which have no hierarchy here. */
  depth: number;
}

function entryFromSymbol(symbol: CodeSymbolLocation): OutlineEntry {
  return {
    key: `${symbol.name}:${symbol.line}:${symbol.column}`,
    name: symbol.name,
    line: symbol.line,
    glyph: KIND_GLYPH[symbol.kind],
    depth: 0,
  };
}

function entriesFromHeadings(document: string): OutlineEntry[] {
  return extractMarkdownHeadings(document).map((heading) => ({
    key: `h${heading.level}:${heading.line}`,
    // An empty heading still gets a row: it is a real position in the document,
    // and a gap in the outline would be more confusing than a blank label.
    name: heading.text,
    line: heading.line,
    glyph: `H${heading.level}`,
    depth: heading.level - 1,
  }));
}

export function EditorOutlineSheet({
  serverId,
  workspaceRoot,
  path,
  visible,
  onClose,
  onSelectLine,
  getDocument,
}: {
  serverId: string;
  workspaceRoot: string;
  path: string;
  visible: boolean;
  onClose: () => void;
  onSelectLine: (line: number) => void;
  /**
   * The open buffer's text, for markdown. Supplied by the file pane through the
   * editor controller; absent when there is no editor (the outline is then
   * daemon-only, which for markdown means empty).
   */
  getDocument?: () => Promise<string>;
}) {
  const { t } = useTranslation();
  // Ungated on compact: the app's overlay bar is wanted on mobile web too,
  // where the platform otherwise draws its dated one. No-ops off web.
  const showWebScrollbar = isWeb;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [symbols, setSymbols] = useState<OutlineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<OutlineEntry>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, {
    enabled: showWebScrollbar,
  });

  // Markdown reads the OPEN BUFFER, not the daemon: the outline of a document
  // you are editing should follow the heading you just typed, and the daemon
  // only knows what is on disk. Everything else asks `code.outline` as before.
  const markdown = isMarkdownPath(path);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (!markdown && !client) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const entries = markdown
          ? entriesFromHeadings((await getDocument?.()) ?? "")
          : ((await client?.getCodeOutline(workspaceRoot, path)) ?? []).map(entryFromSymbol);
        if (active) {
          setSymbols(entries);
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
  }, [client, getDocument, markdown, path, visible, workspaceRoot]);

  const handleSelect = useCallback(
    (line: number) => {
      onSelectLine(line);
      onClose();
    },
    [onClose, onSelectLine],
  );

  const renderRow = useCallback(
    (info: ListRenderItemInfo<OutlineEntry>) => (
      <OutlineRow entry={info.item} onSelect={handleSelect} />
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((entry: OutlineEntry) => entry.key, []);

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
            showWebScrollbar={showWebScrollbar}
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
  showWebScrollbar,
}: {
  error: string | null;
  loadingEmpty: boolean;
  symbols: OutlineEntry[];
  renderRow: (info: ListRenderItemInfo<OutlineEntry>) => ReactElement;
  keyExtractor: (entry: OutlineEntry) => string;
  listRef: RefObject<FlatList<OutlineEntry> | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showWebScrollbar: boolean;
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
        showsVerticalScrollIndicator={!showWebScrollbar}
        testID="editor-outline-results"
      />
      {scrollbar.overlay}
    </View>
  );
}

function OutlineRow({
  entry,
  onSelect,
}: {
  entry: OutlineEntry;
  onSelect: (line: number) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry.line), [onSelect, entry.line]);
  // Move the marker and title together, so heading depth reads in the titles
  // themselves rather than only in the marker column. Margin preserves the
  // marker's full fixed width; padding would squeeze H1–H6 and truncate H2.
  const indentStyle = useMemo(() => ({ marginLeft: entry.depth * HEADING_INDENT }), [entry.depth]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      testID={`editor-outline-symbol-${entry.name}`}
      accessibilityRole="button"
    >
      <Text style={[styles.glyph, indentStyle]} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
        {entry.glyph}
      </Text>
      <Text style={styles.symbolName} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
        {entry.name}
      </Text>
      <Text style={styles.symbolLine}>{entry.line}</Text>
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
    // Heading markers are two characters (H1–H6); 16px lets them wrap in the
    // monospace face used by the outline.
    width: 24,
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
