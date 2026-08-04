import type { CodeRenameFilePlan } from "@otto-code/protocol/messages";
import { useCallback, useMemo, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Check, Pencil, RotateCw, Undo2, X } from "@/components/icons/material-icons";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { compactFont } from "@/styles/theme";
import {
  CodeResultExpandToggle,
  CodeResultGroupHeader,
  CodeResultRow,
  splitPath,
  useCollapsedGroups,
} from "@/editor/code-results/result-rows";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import type { CodeRenameApplyOutcome, CodeRenameUndoOutcome } from "@otto-code/client";
import { useCodeRenameJob, type RenameJobPhase } from "@/editor/rename/use-code-rename-job";

/**
 * A rename as an auditable job.
 *
 * The whole design is the inverse of an inline rename box: the request is taken from the
 * file, set up as a job in its own tab, and the full dry run - every file and every edit -
 * is shown before anything happens. An inline box hides a project-wide blast radius behind
 * one keystroke; this makes the blast radius the thing you are looking at when you decide.
 *
 * Nothing is written until Apply, and Apply sends back only the plan's identity, so the
 * daemon can refuse if what it would write is no longer what was reviewed.
 *
 * Strings are literal English pending the pre-release i18n sweep.
 */

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedCheck = withUnistyles(Check);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedX = withUnistyles(X);

type CodeRenameTarget = Extract<WorkspaceTabTarget, { kind: "codeRename" }>;

function useCodeRenamePanelDescriptor(target: CodeRenameTarget): PanelDescriptor {
  return {
    label: `Rename: ${target.symbol}`,
    tooltip: `Rename: ${target.symbol} → ${target.newName}`,
    subtitle: `→ ${target.newName}`,
    titleState: "ready",
    // Pencil, not SquarePen: SquarePen is the chat/draft tab's icon, so a rename job sitting
    // next to a New Chat tab would read as a second one. Pencil is already the repo's rename
    // glyph (tab context menu, sidebar workspace rename) and is unused by any other tab.
    icon: Pencil,
    statusBucket: null,
  };
}

function CodeRenamePanel() {
  const { serverId, workspaceId, target, openFileInWorkspace, closeCurrentTab } = usePaneContext();
  invariant(target.kind === "codeRename", "CodeRenamePanel requires codeRename target");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const hasLsp = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.lsp === true,
  );

  const job = useCodeRenameJob({
    serverId,
    cwd: cwd ?? "",
    path: target.path,
    line: target.line,
    column: target.column,
    newName: target.newName,
    enabled: hasLsp && Boolean(cwd),
  });

  const groups = useCollapsedGroups();
  const { allExpanded, toggleAll } = groups;
  const paths = useMemo(() => job.files.map((file) => file.path), [job.files]);
  const toggleEverything = useCallback(() => toggleAll(paths), [paths, toggleAll]);

  const openAt = useCallback(
    (path: string, line: number) => {
      openFileInWorkspace({ location: { path, lineStart: line }, disposition: "main" });
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
    <View style={styles.container} testID="code-rename-pane">
      <RenameHeader
        symbol={target.symbol}
        newName={target.newName}
        fileCount={job.fileCount}
        editCount={job.editCount}
        phase={job.phase}
        onApply={job.apply}
        onUndo={job.undo}
        onReplan={job.replan}
        onClose={closeCurrentTab}
        allExpanded={allExpanded(paths)}
        onToggleAll={toggleEverything}
      />
      <PlanBody phase={job.phase}>
        <PlanList
          files={job.files}
          newName={target.newName}
          isCollapsed={groups.isCollapsed}
          onToggleGroup={groups.toggle}
          onOpen={openAt}
        />
      </PlanBody>
    </View>
  );
}

/**
 * Impact first, action second - and the Apply button is only ever enabled against a plan
 * the panel is actually showing. Every other phase disables it, because "apply" with
 * nothing on screen to apply is the exact failure the tab exists to prevent.
 *
 * One row, at the file editor's exact toolbar height. This tab is opened beside the editor
 * in a split, so its chrome is read against the editor's - the impact line used to sit on a
 * second row, which made the bar visibly taller than the one next to it.
 *
 * The action is a `ToolbarIconButton` like every other button here, accent-tinted rather
 * than a labelled CTA. A text button is taller than the icons beside it and would set the
 * bar's height by itself; the label it used to carry is now its tooltip, so nothing about
 * the action is less discoverable than the toolbar's other buttons.
 *
 * After an undo the tab is finished: `onReplan` is withdrawn and the action slot becomes
 * Close. Re-planning at that point asks a language server whose in-memory copy of the file
 * still holds the applied rename - the daemon writes and restores those files itself and
 * never tells the server - so it answers about a symbol that is no longer there. Offering a
 * button that cannot work is worse than not offering one.
 */
function RenameHeader({
  symbol,
  newName,
  fileCount,
  editCount,
  phase,
  onApply,
  onUndo,
  onReplan,
  onClose,
  allExpanded,
  onToggleAll,
}: {
  symbol: string;
  newName: string;
  fileCount: number;
  editCount: number;
  phase: RenameJobPhase;
  onApply: () => void;
  onUndo: () => void;
  onReplan: () => void;
  onClose: () => void;
  allExpanded: boolean;
  onToggleAll: () => void;
}) {
  const isFinished = phase.kind === "undone";
  const isRun = phase.kind === "ran" || phase.kind === "undoing";

  return (
    <View style={styles.header}>
      <Text style={styles.oldName} numberOfLines={1}>
        {symbol}
      </Text>
      <Text style={styles.arrow}>→</Text>
      <Text style={styles.newName} numberOfLines={1}>
        {newName}
      </Text>
      <Text style={styles.impactText} numberOfLines={1}>
        {summarizePhase(phase, fileCount, editCount)}
      </Text>
      <View style={styles.spacer} />
      {/* Only while the plan itself is on screen - the run and undo reports are flat
          lists of files with nothing to fold. */}
      {phase.kind === "ready" ? (
        <CodeResultExpandToggle
          allExpanded={allExpanded}
          onToggle={onToggleAll}
          testID="code-rename-toggle-expand-all"
        />
      ) : null}
      {isFinished ? null : (
        <ToolbarIconButton
          label="Plan again"
          Icon={ThemedRotateCw}
          onPress={onReplan}
          testID="code-rename-replan"
        />
      )}
      {/* One action slot, whose meaning follows the phase. A tab that showed Apply and
          Undo at once would be asking the user to work out which one is live. */}
      <RenameAction
        phase={phase}
        isFinished={isFinished}
        isRun={isRun}
        onApply={onApply}
        onUndo={onUndo}
        onClose={onClose}
      />
    </View>
  );
}

function RenameAction({
  phase,
  isFinished,
  isRun,
  onApply,
  onUndo,
  onClose,
}: {
  phase: RenameJobPhase;
  isFinished: boolean;
  isRun: boolean;
  onApply: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  if (isFinished) {
    return (
      <ToolbarIconButton
        label="Close"
        Icon={ThemedX}
        tone="accent"
        onPress={onClose}
        testID="code-rename-close"
      />
    );
  }
  if (isRun) {
    // Undo is the only action left once the rename has run, so it keeps the accent -
    // there is nothing else in the bar for the tint to compete with.
    return (
      <ToolbarIconButton
        label={phase.kind === "undoing" ? "Undoing…" : "Undo this rename"}
        Icon={ThemedUndo2}
        tone="accent"
        onPress={onUndo}
        loading={phase.kind === "undoing"}
        testID="code-rename-undo"
      />
    );
  }
  return (
    <ToolbarIconButton
      label={phase.kind === "applying" ? "Running…" : "Apply rename"}
      Icon={ThemedCheck}
      tone="accent"
      onPress={onApply}
      disabled={phase.kind !== "ready"}
      loading={phase.kind === "applying"}
      testID="code-rename-apply"
    />
  );
}

function PlanBody({ phase, children }: { phase: RenameJobPhase; children: React.ReactNode }) {
  if (phase.kind === "planning") {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>
          {phase.waitingForProject
            ? "Waiting for the project to finish loading - a plan made now would under-report what this rename touches."
            : "Working out what this rename would change…"}
        </Text>
      </View>
    );
  }
  if (phase.kind === "failed") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{phase.reason}</Text>
      </View>
    );
  }
  if (phase.kind === "ran" || phase.kind === "undoing") {
    return <RunReport outcome={phase.outcome} />;
  }
  if (phase.kind === "undone") {
    return <UndoReport undo={phase.undo} />;
  }
  return children;
}

/**
 * What the run actually did, file by file.
 *
 * Every file is listed, including the ones that came out clean - a report that showed only
 * problems would leave the user unable to tell "nothing went wrong" from "nothing ran".
 */
function RunReport({ outcome }: { outcome: CodeRenameApplyOutcome }) {
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
        {outcome.files.map((file) => (
          <OutcomeRow
            key={file.path}
            path={file.path}
            tone={RUN_TONE[file.kind]}
            status={describeRunFile(file)}
            reason={file.reason}
          />
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * What the undo did. `changedSince` is the row that matters: the file was edited after the
 * run, so restoring it would have destroyed that work and it was deliberately left alone.
 */
function UndoReport({ undo }: { undo: CodeRenameUndoOutcome }) {
  return (
    <View style={styles.listHost}>
      <ScrollView style={styles.listScroll}>
        {undo.files.map((file) => (
          <OutcomeRow
            key={file.path}
            path={file.path}
            tone={UNDO_TONE[file.kind]}
            status={UNDO_STATUS[file.kind]}
            reason={file.reason}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function OutcomeRow({
  path,
  tone,
  status,
  reason,
}: {
  path: string;
  tone: "good" | "warn" | "bad";
  status: string;
  reason: string | null;
}) {
  const { head, tail } = useMemo(() => splitPath(path), [path]);

  return (
    <View style={styles.outcomeRow}>
      <View style={styles.outcomeHead}>
        <View style={styles[TONE_DOT[tone]]} />
        <Text style={styles.outcomeName} numberOfLines={1}>
          {tail}
        </Text>
        <Text style={styles.outcomeDir} numberOfLines={1}>
          {head}
        </Text>
        <View style={styles.spacer} />
        <Text style={styles[TONE_TEXT[tone]]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {reason ? (
        <Text style={styles.outcomeReason} numberOfLines={2}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

const RUN_TONE = { applied: "good", partial: "warn", failed: "bad" } as const;

function describeRunFile(file: CodeRenameApplyOutcome["files"][number]): string {
  if (file.kind === "applied") {
    return `${file.appliedEdits} applied`;
  }
  if (file.kind === "partial") {
    return `${file.appliedEdits} applied, ${file.skippedEdits} skipped`;
  }
  return "not changed";
}

const UNDO_TONE = { restored: "good", changedSince: "warn", failed: "bad" } as const;
const UNDO_STATUS = {
  restored: "put back",
  changedSince: "left as it is",
  failed: "could not undo",
} as const;

const TONE_DOT = { good: "dotGood", warn: "dotWarn", bad: "dotBad" } as const;
const TONE_TEXT = { good: "statusGood", warn: "statusWarn", bad: "statusBad" } as const;

/** The one line that answers "what is this tab telling me" for every phase. */
function summarizePhase(phase: RenameJobPhase, fileCount: number, editCount: number): string {
  if (phase.kind === "ready") {
    const edits = `${editCount} ${editCount === 1 ? "edit" : "edits"}`;
    const files = `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
    return `${edits} across ${files}. Nothing has been written yet.`;
  }
  if (phase.kind === "ran" || phase.kind === "undoing") {
    const { appliedEdits, skippedEdits, appliedFiles, complete } = phase.outcome;
    if (complete) {
      return `Done - ${appliedEdits} ${appliedEdits === 1 ? "edit" : "edits"} written across ${appliedFiles} ${appliedFiles === 1 ? "file" : "files"}.`;
    }
    return `${appliedEdits} written, ${skippedEdits} skipped because the files had changed. Undo puts back only what this run wrote.`;
  }
  if (phase.kind === "undone") {
    return phase.undo.complete
      ? `Undone - ${phase.undo.restoredFiles} ${phase.undo.restoredFiles === 1 ? "file" : "files"} put back.`
      : `${phase.undo.restoredFiles} put back. The rest were edited after the rename and were left alone.`;
  }
  return "";
}

function PlanList({
  files,
  newName,
  isCollapsed,
  onToggleGroup,
  onOpen,
}: {
  files: readonly CodeRenameFilePlan[];
  newName: string;
  isCollapsed: (path: string) => boolean;
  onToggleGroup: (path: string) => void;
  onOpen: (path: string, line: number) => void;
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
        {files.map((file) => (
          <FileGroup
            key={file.path}
            file={file}
            newName={newName}
            collapsed={isCollapsed(file.path)}
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
  file,
  newName,
  collapsed,
  onToggle,
  onOpen,
}: {
  file: CodeRenameFilePlan;
  newName: string;
  collapsed: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string, line: number) => void;
}) {
  return (
    <View style={styles.group}>
      <CodeResultGroupHeader
        path={file.path}
        count={file.edits.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {collapsed
        ? null
        : file.edits.map((edit) => (
            <EditRow
              key={`${edit.line}:${edit.column}`}
              path={file.path}
              line={edit.line}
              column={edit.column}
              newText={edit.newText || newName}
              onOpen={onOpen}
            />
          ))}
    </View>
  );
}

function EditRow({
  path,
  line,
  column,
  newText,
  onOpen,
}: {
  path: string;
  line: number;
  column: number;
  newText: string;
  onOpen: (path: string, line: number) => void;
}) {
  const open = useCallback(() => onOpen(path, line), [line, onOpen, path]);

  return (
    <CodeResultRow
      gutter={`${line}:${column}`}
      gutterWidth="lineColumn"
      text={newText}
      accessibilityLabel={`Line ${line}`}
      onPress={open}
      testID="code-rename-edit"
    />
  );
}

export const codeRenamePanelRegistration: PanelRegistration<"codeRename"> = {
  kind: "codeRename",
  component: CodeRenamePanel,
  useDescriptor: useCodeRenamePanelDescriptor,
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
  // Same geometry as the file editor's toolbar, down to the padding: this tab
  // opens beside the editor in a split, and a bar that is a few pixels off reads
  // as a mistake in the split, not as a different panel.
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  spacer: {
    flex: 1,
  },
  oldName: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    textDecorationLine: "line-through",
    flexShrink: 1,
  },
  arrow: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
  },
  newName: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: "600",
    flexShrink: 1,
  },
  // Shrinks before the names do - the symbol being renamed is what identifies
  // the tab, so it is the last thing that should be truncated.
  impactText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 2,
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
    maxWidth: 520,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: compactFont(theme.fontSize.sm),
    textAlign: "center",
    maxWidth: 520,
  },
  outcomeRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  outcomeHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  outcomeName: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 0,
  },
  outcomeDir: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 1,
  },
  outcomeReason: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    paddingLeft: theme.spacing[3],
  },
  dotGood: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusSuccess },
  dotWarn: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusWarning },
  dotBad: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusDanger },
  statusGood: { color: theme.colors.statusSuccess, fontSize: compactFont(theme.fontSize.sm) },
  statusWarn: { color: theme.colors.statusWarning, fontSize: compactFont(theme.fontSize.sm) },
  statusBad: { color: theme.colors.statusDanger, fontSize: compactFont(theme.fontSize.sm) },
}));
