/**
 * The Logs tab: the brain's llama-server output.
 *
 * This is the TUI's `l` view, which had no equivalent anywhere outside the
 * terminal. It is the first place to look when a model will not load, so it
 * matters most exactly when the brain is failing, which is when the TUI is least
 * likely to be reachable.
 */
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Copy } from "@/components/icons/material-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useBrainLogs } from "./use-brain-data";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedCopy = withUnistyles(Copy);
const copyIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const copyIcon = <ThemedCopy uniProps={copyIconMapping} />;

/**
 * llama.cpp writes warnings and errors on the same stream as ordinary progress,
 * so the level has to be read out of the text. Cheap substring checks, matching
 * what the TUI colours on.
 */
function lineTone(line: string): "error" | "warn" | "normal" {
  const lower = line.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("fatal")) {
    return "error";
  }
  if (lower.includes("warn")) {
    return "warn";
  }
  return "normal";
}

function LogLine({ line }: { line: string }) {
  const tone = lineTone(line);
  const style = useMemo(
    () => [styles.line, tone === "error" && styles.lineError, tone === "warn" && styles.lineWarn],
    [tone],
  );
  return <Text style={style}>{line}</Text>;
}

export function BrainLogsTab({
  serverId,
  isConnected,
}: {
  serverId: string;
  isConnected: boolean;
}) {
  const query = useBrainLogs(serverId, isConnected);
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const [follow, setFollow] = useState(true);

  const lines = useMemo(() => query.data?.lines ?? [], [query.data]);
  const lineCount = lines.length;
  const total = query.data?.total ?? lineCount;

  /**
   * Log lines repeat verbatim, so the text alone is not an identity. The
   * ABSOLUTE line number is: the brain keeps a rolling buffer and reports how
   * many lines it has seen in total, so the oldest line still held is
   * `total - lines.length`. That stays put as the buffer rolls, where a bare
   * array index would renumber every line each time one scrolled off the top.
   */
  const entries = useMemo(() => {
    const firstLineNumber = total - lineCount;
    return lines.map((line, index) => ({ key: String(firstLineNumber + index), line }));
  }, [lineCount, lines, total]);

  // Follow the tail as new lines arrive, but only while the reader has not
  // scrolled up. Scrolling back through a failure and being yanked to the bottom
  // two seconds later makes the log unreadable exactly when it is needed.
  useEffect(() => {
    if (follow && lineCount > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [follow, lineCount]);

  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        layoutMeasurement: { height: number };
        contentOffset: { y: number };
        contentSize: { height: number };
      };
    }) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      setFollow(distanceFromBottom < 40);
    },
    [],
  );

  const handleResume = useCallback(() => {
    setFollow(true);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(lines.join("\n"))
      .then(() => toast.copied("Logs copied to clipboard"))
      .catch(() => toast.error("Could not copy logs"));
  }, [lines, toast]);

  if (query.isLoading && lineCount === 0) {
    return (
      <View style={styles.centered}>
        <ThemedSpinner size="large" />
      </View>
    );
  }

  if (query.error) {
    return (
      <Alert
        variant="error"
        title="Could not read the log"
        description={query.error instanceof Error ? query.error.message : String(query.error)}
      />
    );
  }

  if (lineCount === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>No log output yet</Text>
        <Text style={styles.emptyHint}>Load a model to see what the server reports.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.meta}>{`${total} lines · ${query.data?.state ?? "unknown"}`}</Text>
        <View style={styles.actions}>
          {follow ? null : (
            <Button variant="ghost" size="sm" onPress={handleResume} testID="brain-logs-follow">
              Jump to latest
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={copyIcon}
            onPress={handleCopy}
            testID="brain-logs-copy"
          >
            Copy
          </Button>
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={isNative}
        dataSet={CODE_SURFACE_DATASET}
      >
        {entries.map((entry) => (
          <LogLine key={entry.key} line={entry.line} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    gap: theme.spacing[2],
    minHeight: 0,
  },
  centered: {
    paddingVertical: theme.spacing[12],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  empty: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  meta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  // The llama-server tail is a code/terminal surface, so it sits on
  // `surfaceCode` - the same well the editor and tool-card diffs paint
  // (styles/theme.ts) - rather than the generic elevated-panel `surface3`.
  scroll: {
    flex: 1,
    minHeight: 0,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceCode,
  },
  scrollContent: {
    padding: theme.spacing[3],
  },
  line: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  lineWarn: {
    color: theme.colors.palette.yellow[400],
  },
  lineError: {
    color: theme.colors.palette.red[500],
  },
}));
