import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useSessionStore } from "@/stores/session-store";
import { fuzzyFilter } from "@/file-explorer/fuzzy-match";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const MAX_RESULTS = 100;

const ThemedFinderInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function basename(path: string): string {
  return path.split("/").findLast(Boolean) ?? path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

export function FileFinderOverlay({
  serverId,
  workspaceRoot,
  visible,
  onClose,
  onOpenFile,
}: {
  serverId: string;
  workspaceRoot: string;
  visible: boolean;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput | null>(null);
  const listRef = useRef<FlatList<string>>(null);
  const scrollbar = useWebScrollViewScrollbar(listRef, {
    enabled: showDesktopWebScrollbar,
  });

  // Load the file list each time the finder opens so it reflects the tree.
  useEffect(() => {
    if (!visible || !client) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setQuery("");
    const load = async () => {
      try {
        const payload = await client.listCodeFiles(workspaceRoot);
        if (!active) {
          return;
        }
        if (payload.error) {
          setError(payload.error);
          setFiles([]);
        } else {
          setFiles(payload.files);
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
  }, [client, visible, workspaceRoot]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () => fuzzyFilter(files, query, (path) => path, MAX_RESULTS).map((match) => match.item),
    [files, query],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onOpenFile(path);
      onClose();
    },
    [onClose, onOpenFile],
  );

  const handleSubmit = useCallback(() => {
    if (results.length > 0) {
      handleSelect(results[0]);
    }
  }, [handleSelect, results]);

  const renderRow = useCallback(
    (info: ListRenderItemInfo<string>) => <FinderRow path={info.item} onSelect={handleSelect} />,
    [handleSelect],
  );

  const keyExtractor = useCallback((path: string) => path, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={focusInput}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="file-finder-backdrop">
        <Pressable style={styles.panel} testID="file-finder-panel">
          <ThemedFinderInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t("fileFinder.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={handleSubmit}
            testID="file-finder-input"
          />
          <FileFinderBody
            error={error}
            loadingEmpty={loading && files.length === 0}
            results={results}
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

function FileFinderBody({
  error,
  loadingEmpty,
  results,
  renderRow,
  keyExtractor,
  listRef,
  scrollbar,
  showDesktopWebScrollbar,
}: {
  error: string | null;
  loadingEmpty: boolean;
  results: string[];
  renderRow: (info: ListRenderItemInfo<string>) => ReactElement;
  keyExtractor: (path: string) => string;
  listRef: RefObject<FlatList<string> | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showDesktopWebScrollbar: boolean;
}) {
  const { t } = useTranslation();
  if (error) {
    return <Text style={styles.errorText}>{error}</Text>;
  }
  if (loadingEmpty) {
    return <Text style={styles.mutedText}>{t("fileFinder.loading")}</Text>;
  }
  if (results.length === 0) {
    return <Text style={styles.mutedText}>{t("fileFinder.noResults")}</Text>;
  }
  return (
    <View style={styles.listContainer}>
      <FlatList
        ref={listRef}
        data={results}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        testID="file-finder-results"
      />
      {scrollbar.overlay}
    </View>
  );
}

function FinderRow({ path, onSelect }: { path: string; onSelect: (path: string) => void }) {
  const handlePress = useCallback(() => onSelect(path), [onSelect, path]);
  const dir = dirname(path);
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      testID={`file-finder-result-${path}`}
      accessibilityRole="button"
    >
      <Text style={styles.rowName} numberOfLines={1}>
        {basename(path)}
      </Text>
      {dir ? (
        <Text style={styles.rowDir} numberOfLines={1}>
          {dir}
        </Text>
      ) : null}
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
  input: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
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
    alignItems: "baseline",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  rowName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowDir: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
