import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import type { GitBlameCommit, GitFileHistoryEntry } from "@otto-code/protocol/messages";
import { History, Pilcrow, RotateCw } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResizeHandle } from "@/components/resize-handle";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { compactFont, compactUp, useIconSize, type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { useFileHistoryLayoutStore } from "@/stores/file-history-layout-store";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { CommitDetail } from "@/git/file-history/commit-detail";
import { CommitTable, CommitTableHeader } from "@/git/file-history/commit-table";
import { RevisionDiff, type RevisionFocus } from "@/git/file-history/revision-diff";
import { useFileHistory, useFileOrigin } from "@/git/file-history/use-file-history-data";

/**
 * Git investigation for one file, as a stack of three resizable panes: the
 * commit table, the selected revision's diff, and that commit's full message.
 *
 * Stacked rather than side by side because a diff is a wide thing. Putting the
 * commit list beside it spends horizontal space — the axis code actually needs —
 * on four narrow columns, and then every line of the diff wraps or scrolls. The
 * list is short and wide, the diff is tall and wide; they belong on top of each
 * other.
 *
 * Blame is not a separate view here: it annotates the diff's gutter, beside the
 * lines it describes. See revision-diff-body.tsx.
 *
 * Local git only, and provider-neutral: see docs/git-file-history.md.
 */

const RESIZE_GROUP_ID = "file-history-split";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedRotateCw = withUnistyles(RotateCw);

// Derived from the tab union rather than restated, so a change to the target
// shape reaches this panel as a type error instead of a silent drift.
type FileHistoryTarget = Extract<WorkspaceTabTarget, { kind: "fileHistory" }>;

function fileHistoryTabTitle(target: FileHistoryTarget): string {
  const name = target.path.split("/").at(-1) ?? target.path;
  return `History: ${name}`;
}

function useFileHistoryPanelDescriptor(target: FileHistoryTarget): PanelDescriptor {
  const { t } = useTranslation();
  const hasRange = target.startLine !== undefined && target.endLine !== undefined;
  return {
    label: fileHistoryTabTitle(target),
    subtitle: hasRange
      ? t("gitFileHistory.scopeLines", { start: target.startLine, end: target.endLine })
      : target.path,
    titleState: "ready",
    icon: History,
    statusBucket: null,
  };
}

function FileHistoryPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "fileHistory", "FileHistoryPanel requires fileHistory target");
  const { t } = useTranslation();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isCompact = useIsCompactFormFactor();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitFileHistory === true,
  );

  const [selected, setSelected] = useState<GitFileHistoryEntry | null>(null);
  const [blameFocus, setBlameFocus] = useState<RevisionFocus | null>(null);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  // Bumped to re-run the queries; the data hooks are one-shot reads with no
  // push channel, so a refresh is an explicit act.
  const [reloadToken, setReloadToken] = useState(0);

  const sizes = useFileHistoryLayoutStore((state) => state.sizes);
  const setSizes = useFileHistoryLayoutStore((state) => state.setSizes);

  const range = useMemo(
    () =>
      target.startLine !== undefined && target.endLine !== undefined
        ? { startLine: target.startLine, endLine: target.endLine }
        : null,
    [target.startLine, target.endLine],
  );

  const notARepoLabel = t("gitFileHistory.notARepo");
  const history = useFileHistory({
    serverId,
    cwd: cwd ?? "",
    path: target.path,
    range,
    enabled: supported && Boolean(cwd),
    reloadToken,
    notARepoLabel,
  });
  const origin = useFileOrigin({
    serverId,
    cwd: cwd ?? "",
    path: target.path,
    enabled: supported && Boolean(cwd) && range === null,
    notARepoLabel,
  });

  // Land on the newest commit so the diff pane has something in it the moment
  // the tab opens, instead of an empty half-screen asking to be clicked.
  const firstEntry = history.entries[0];
  useEffect(() => {
    setSelected((current) => current ?? firstEntry ?? null);
  }, [firstEntry]);

  const handleSelectEntry = useCallback((entry: GitFileHistoryEntry) => {
    setBlameFocus(null);
    setSelected(entry);
  }, []);

  const handleSelectBlameCommit = useCallback(
    (commit: GitBlameCommit) => {
      // Blame knows the sha and the file's name in that commit, but nothing
      // else. If the sha is one the history already loaded, reuse that entry so
      // the message pane fills in too; otherwise show what blame does know.
      const known = history.entries.find((entry) => entry.sha === commit.sha) ?? null;
      setSelected(known);
      setBlameFocus(
        known
          ? null
          : {
              sha: commit.sha,
              shortSha: commit.shortSha,
              path: commit.path ?? target.path,
            },
      );
    },
    [history.entries, target.path],
  );

  const handleResize = useCallback(
    (_groupId: string, nextSizes: number[]) => setSizes(nextSizes),
    [setSizes],
  );
  const toggleWhitespace = useCallback(() => setIgnoreWhitespace((current) => !current), []);
  const handleRefresh = useCallback(() => setReloadToken((current) => current + 1), []);

  const focus: RevisionFocus | null = blameFocus ?? entryToFocus(selected);

  // One share model for every pane: each flexes from a zero basis, so a stored
  // ratio means the same fraction of the stack no matter how tall the pane is.
  const listPaneStyle = usePaneStyle(styles.listPane, sizes[0]);
  const diffPaneStyle = usePaneStyle(styles.diffPane, sizes[1]);
  const detailPaneStyle = usePaneStyle(styles.detailPane, sizes[2]);

  if (!supported) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{t("gitFileHistory.unsupportedHost")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="file-history-pane">
      <FileHistoryToolbar
        range={range}
        origin={origin.entry}
        ignoreWhitespace={ignoreWhitespace}
        onToggleWhitespace={toggleWhitespace}
        onRefresh={handleRefresh}
      />
      <View style={styles.stack}>
        <View style={listPaneStyle}>
          <ListPane
            history={history}
            selectedSha={focus?.sha ?? null}
            onSelectEntry={handleSelectEntry}
          />
        </View>
        {isCompact ? null : (
          <ResizeHandle
            direction="vertical"
            groupId={RESIZE_GROUP_ID}
            index={0}
            sizes={sizes}
            onResizeSplit={handleResize}
          />
        )}
        <View style={diffPaneStyle}>
          <RevisionDiff
            serverId={serverId}
            cwd={cwd ?? ""}
            focus={focus}
            ignoreWhitespace={ignoreWhitespace}
            notARepoLabel={notARepoLabel}
            onSelectBlameCommit={handleSelectBlameCommit}
          />
        </View>
        {isCompact ? null : (
          <ResizeHandle
            direction="vertical"
            groupId={RESIZE_GROUP_ID}
            index={1}
            sizes={sizes}
            onResizeSplit={handleResize}
          />
        )}
        <View style={detailPaneStyle}>
          <CommitDetail entry={selected} />
        </View>
      </View>
    </View>
  );
}

/** A pane's share of the stack, as a flex grow from a zero basis. */
function usePaneStyle(base: object, share: number | undefined) {
  return useMemo(
    () => [base, inlineUnistylesStyle({ flexGrow: share ?? 1, flexBasis: 0 })],
    [base, share],
  );
}

/**
 * The pane's own toolbar. The origin commit sits here rather than as a banner
 * inside the list — it is a fact about the file, true regardless of which commit
 * is selected, so it belongs with the file's other facts.
 */
function FileHistoryToolbar({
  range,
  origin,
  ignoreWhitespace,
  onToggleWhitespace,
  onRefresh,
}: {
  range: { startLine: number; endLine: number } | null;
  origin: GitFileHistoryEntry | null;
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  return (
    <View style={styles.toolbar}>
      {range ? (
        <Text style={styles.scopeChip} numberOfLines={1}>
          {t("gitFileHistory.scopeLines", { start: range.startLine, end: range.endLine })}
        </Text>
      ) : null}
      {origin ? (
        <Text style={styles.originText} numberOfLines={1}>
          {t("gitFileHistory.originBy", {
            author: origin.authorName,
            when: new Date(origin.authoredAt * 1000).toLocaleDateString(),
          })}
        </Text>
      ) : null}
      <View style={styles.toolbarSpacer} />
      <ToolbarIconButton
        label={t("gitFileHistory.ignoreWhitespace")}
        active={ignoreWhitespace}
        onPress={onToggleWhitespace}
        testID="file-history-ignore-whitespace"
      >
        <ThemedPilcrow
          size={iconSize.sm}
          uniProps={ignoreWhitespace ? accentColorMapping : mutedColorMapping}
        />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("gitFileHistory.refresh")}
        onPress={onRefresh}
        testID="file-history-refresh"
      >
        <ThemedRotateCw size={iconSize.sm} uniProps={mutedColorMapping} />
      </ToolbarIconButton>
    </View>
  );
}

/**
 * An icon-only toolbar control with a tooltip, matching the Changes toolbar.
 * `active` gives a toggle a visible on-state — an icon toggle that looks
 * identical in both states is a switch you cannot read.
 */
function ToolbarIconButton({
  label,
  active = false,
  onPress,
  testID,
  children,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.toolbarButton,
      (Boolean(hovered) || pressed) && styles.toolbarButtonHovered,
      active && styles.toolbarButtonActive,
    ],
    [active],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-pressed={active}
        testID={testID}
        onPress={onPress}
        style={buttonStyle}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The commit table. The column header is pinned outside the scroll view — a
 * header that scrolls away stops naming anything the moment you use the table.
 */
function ListPane({
  history,
  selectedSha,
  onSelectEntry,
}: {
  history: ReturnType<typeof useFileHistory>;
  selectedSha: string | null;
  onSelectEntry: (entry: GitFileHistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  // Not gated on form factor: a narrow browser window still draws the platform's
  // dated bar, so compact web needs the overlay every bit as much as desktop.
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });

  return (
    <View style={styles.listHost}>
      <CommitTableHeader />
      <ListBody
        error={history.error}
        loading={history.loading}
        rowCount={history.entries.length}
        emptyLabel={t("gitFileHistory.empty")}
      >
        <View style={styles.listScrollHost}>
          <ScrollView
            ref={scrollRef}
            style={styles.listScroll}
            onLayout={scrollbar.onLayout}
            onScroll={scrollbar.onScroll}
            onContentSizeChange={scrollbar.onContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!isWeb}
          >
            <CommitTable
              entries={history.entries}
              selectedSha={selectedSha}
              onSelect={onSelectEntry}
              hasMore={history.hasMore}
              loadingMore={history.loadingMore}
              onLoadMore={history.loadMore}
            />
          </ScrollView>
          {scrollbar.overlay}
        </View>
      </ListBody>
    </View>
  );
}

/** Error / first-load / empty / content, in that order of precedence. */
function ListBody({
  error,
  loading,
  rowCount,
  emptyLabel,
  children,
}: {
  error: string | null;
  loading: boolean;
  rowCount: number;
  emptyLabel: string;
  children: ReactNode;
}): ReactNode {
  const { t } = useTranslation();
  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (loading && rowCount === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{t("gitFileHistory.loading")}</Text>
      </View>
    );
  }
  if (rowCount === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{emptyLabel}</Text>
      </View>
    );
  }
  return children;
}

function entryToFocus(entry: GitFileHistoryEntry | null): RevisionFocus | null {
  if (!entry) {
    return null;
  }
  return { sha: entry.sha, shortSha: entry.shortSha, path: entry.path };
}

export const fileHistoryPanelRegistration: PanelRegistration<"fileHistory"> = {
  kind: "fileHistory",
  component: FileHistoryPanel,
  useDescriptor: useFileHistoryPanelDescriptor,
  confirmClose() {
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.background,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarSpacer: {
    flex: 1,
  },
  toolbarButton: {
    alignItems: "center",
    justifyContent: "center",
    width: compactUp(26, 1.5),
    height: compactUp(26, 1.5),
    borderRadius: theme.borderRadius.sm,
  },
  toolbarButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  toolbarButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
  },
  scopeChip: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  originText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  stack: {
    flex: 1,
    minHeight: 0,
    flexDirection: "column",
  },
  listPane: {
    minHeight: 0,
  },
  diffPane: {
    minHeight: 0,
  },
  detailPane: {
    minHeight: 0,
  },
  listHost: {
    flex: 1,
    minHeight: 0,
  },
  listScrollHost: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  listScroll: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: compactFont(theme.fontSize.sm),
    textAlign: "center",
  },
}));
