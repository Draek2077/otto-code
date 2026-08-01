import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import type { CodeDefinitionLocation } from "@otto-code/protocol/messages";
import { RotateCw, Search } from "@/components/icons/material-icons";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { compactFont } from "@/styles/theme";
import {
  CodeResultExpandToggle,
  CodeResultGroupHeader,
  CodeResultRow,
  useCollapsedGroups,
} from "@/editor/code-results/result-rows";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import {
  useCodeReferences,
  type CodeReferencesGroup,
} from "@/editor/references/use-code-references";
import {
  useReferencePreviews,
  type CodeLinePreview,
  type PreviewsByPath,
} from "@/editor/references/use-reference-previews";

/**
 * Every reference to one symbol, as a results tab you navigate FROM.
 *
 * A tab rather than a dialog, for the reason git-file-history already argues: this is a
 * working surface you keep open beside the code, and visiting a hit is the whole point — a
 * dialog would be dismissed by the very act of using it. One tab per (path, line, column),
 * so a second search does not evict the first.
 *
 * Grouped by file rather than a flat table. A flat list of 40 rows repeats the same path 12
 * times and buries the fact that the symbol touches four files, which is usually the first
 * thing you wanted to know.
 *
 * Strings are literal English pending the pre-release i18n sweep.
 */

const ThemedRotateCw = withUnistyles(RotateCw);

type CodeReferencesTarget = Extract<WorkspaceTabTarget, { kind: "codeReferences" }>;

function useCodeReferencesPanelDescriptor(target: CodeReferencesTarget): PanelDescriptor {
  return {
    label: `References: ${target.symbol}`,
    tooltip: `References: ${target.symbol} (${target.path}:${target.line})`,
    subtitle: `${target.path}:${target.line}`,
    titleState: "ready",
    icon: Search,
    statusBucket: null,
  };
}

function CodeReferencesPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "codeReferences", "CodeReferencesPanel requires codeReferences target");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const hasLsp = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.lsp === true,
  );

  const references = useCodeReferences({
    serverId,
    cwd: cwd ?? "",
    path: target.path,
    line: target.line,
    column: target.column,
    enabled: hasLsp && Boolean(cwd),
  });

  const previews = useReferencePreviews({
    serverId,
    cwd: cwd ?? "",
    groups: references.groups,
    enabled: hasLsp && Boolean(cwd),
  });

  const groups = useCollapsedGroups();
  const { allExpanded, toggleAll } = groups;
  const paths = useMemo(() => references.groups.map((group) => group.path), [references.groups]);
  const toggleEverything = useCallback(() => toggleAll(paths), [paths, toggleAll]);

  const openHit = useCallback(
    (hit: CodeDefinitionLocation) => {
      openFileInWorkspace({
        location: { path: hit.path, lineStart: hit.line },
        disposition: "main",
      });
    },
    [openFileInWorkspace],
  );

  if (!hasLsp) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>Update the host to use code intelligence.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="code-references-pane">
      <ReferencesToolbar
        symbol={target.symbol}
        hitCount={references.hitCount}
        fileCount={references.fileCount}
        provisional={references.provisional}
        gaveUp={references.gaveUp}
        onRefresh={references.refresh}
        allExpanded={allExpanded(paths)}
        onToggleAll={toggleEverything}
      />
      <ResultsBody references={references}>
        <ResultsList
          groups={references.groups}
          previews={previews}
          isCollapsed={groups.isCollapsed}
          onToggleGroup={groups.toggle}
          onOpen={openHit}
        />
      </ResultsBody>
    </View>
  );
}

/**
 * Counts first, because "how many places and how many files" is the question a references
 * search is usually standing in for.
 *
 * The provisional chip is not decoration. The daemon reports `indexing` while a language
 * server is still building its project model, and a list captured then can be a fraction of
 * the truth — measured at 2 hits in 1 file where the real answer was 14 in 4. Showing a count
 * without saying it is still settling is how a search quietly lies.
 */
function ReferencesToolbar({
  symbol,
  hitCount,
  fileCount,
  provisional,
  gaveUp,
  onRefresh,
  allExpanded,
  onToggleAll,
}: {
  symbol: string;
  hitCount: number;
  fileCount: number;
  provisional: boolean;
  gaveUp: boolean;
  onRefresh: () => void;
  allExpanded: boolean;
  onToggleAll: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <Text style={styles.symbolText} numberOfLines={1}>
        {symbol}
      </Text>
      <Text style={styles.countText} numberOfLines={1}>
        {`${hitCount} ${hitCount === 1 ? "reference" : "references"} in ${fileCount} ${
          fileCount === 1 ? "file" : "files"
        }`}
      </Text>
      {provisional ? (
        <Tooltip delayDuration={300}>
          <TooltipTrigger accessibilityRole="text" style={styles.provisionalChip}>
            <Text style={styles.provisionalText}>Still loading</Text>
          </TooltipTrigger>
          <TooltipContent side="bottom" maxWidth={360}>
            <Text style={styles.tooltipText}>
              A language server is still building its project model, so this list may be incomplete.
              It refreshes itself as the project settles.
            </Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      {gaveUp ? (
        <Tooltip delayDuration={300}>
          <TooltipTrigger accessibilityRole="text" style={styles.staleChip}>
            <Text style={styles.staleText}>May be incomplete</Text>
          </TooltipTrigger>
          <TooltipContent side="bottom" maxWidth={360}>
            <Text style={styles.tooltipText}>
              The project never finished loading, so this list is what the server could answer.
              Refresh to ask again.
            </Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      <View style={styles.toolbarSpacer} />
      <CodeResultExpandToggle
        allExpanded={allExpanded}
        onToggle={onToggleAll}
        testID="code-references-toggle-expand-all"
      />
      <ToolbarIconButton
        label="Search again"
        Icon={ThemedRotateCw}
        onPress={onRefresh}
        testID="code-references-refresh"
      />
    </View>
  );
}

/** Error / first-load / empty / content, in that order of precedence. */
function ResultsBody({
  references,
  children,
}: {
  references: ReturnType<typeof useCodeReferences>;
  children: ReactNode;
}): ReactNode {
  if (references.unavailable) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>
          No language server on the host covers this file, so it cannot resolve references.
        </Text>
      </View>
    );
  }
  if (references.error !== null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{references.error}</Text>
      </View>
    );
  }
  if (references.loading && references.hitCount === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>Searching…</Text>
      </View>
    );
  }
  if (references.hitCount === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>No references found.</Text>
      </View>
    );
  }
  return children;
}

function ResultsList({
  groups,
  previews,
  isCollapsed,
  onToggleGroup,
  onOpen,
}: {
  groups: readonly CodeReferencesGroup[];
  previews: PreviewsByPath;
  isCollapsed: (path: string) => boolean;
  onToggleGroup: (path: string) => void;
  onOpen: (hit: CodeDefinitionLocation) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });

  return (
    <View style={styles.listHost}>
      <ScrollView
        ref={scrollRef}
        style={styles.listScroll}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
      >
        {groups.map((group) => (
          <FileGroup
            key={group.path}
            group={group}
            preview={previews[group.path]}
            collapsed={isCollapsed(group.path)}
            onToggle={onToggleGroup}
            onOpen={onOpen}
          />
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

function FileGroup({
  group,
  preview,
  collapsed,
  onToggle,
  onOpen,
}: {
  group: CodeReferencesGroup;
  preview: Record<number, CodeLinePreview> | undefined;
  collapsed: boolean;
  onToggle: (path: string) => void;
  onOpen: (hit: CodeDefinitionLocation) => void;
}) {
  return (
    <View style={styles.group}>
      <CodeResultGroupHeader
        path={group.path}
        count={group.hits.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {collapsed
        ? null
        : group.hits.map((hit) => (
            <HitRow
              key={`${hit.line}:${hit.column}`}
              hit={hit}
              preview={preview?.[hit.line]}
              onOpen={onOpen}
            />
          ))}
    </View>
  );
}

function HitRow({
  hit,
  preview,
  onOpen,
}: {
  hit: CodeDefinitionLocation;
  preview: CodeLinePreview | undefined;
  onOpen: (hit: CodeDefinitionLocation) => void;
}) {
  const open = useCallback(() => onOpen(hit), [hit, onOpen]);

  return (
    <CodeResultRow
      gutter={String(hit.line)}
      text={preview?.text ?? `Col ${hit.column}`}
      tokens={preview?.tokens}
      accessibilityLabel={`Line ${hit.line}`}
      onPress={open}
      testID="code-references-hit"
    />
  );
}

export const codeReferencesPanelRegistration: PanelRegistration<"codeReferences"> = {
  kind: "codeReferences",
  component: CodeReferencesPanel,
  useDescriptor: useCodeReferencesPanelDescriptor,
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
  // Same geometry as the file editor's toolbar, down to the padding: these tabs
  // open beside the editor in a split, and a bar that is a few pixels off reads
  // as a mistake in the split, not as a different panel.
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarSpacer: {
    flex: 1,
  },
  symbolText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 0,
  },
  countText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 1,
  },
  provisionalChip: {
    borderWidth: 1,
    borderColor: theme.colors.statusWarning,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  provisionalText: {
    color: theme.colors.statusWarning,
    fontSize: compactFont(theme.fontSize.xs),
  },
  staleChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  staleText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
  },
  listHost: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  listScroll: {
    flex: 1,
  },
  group: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
