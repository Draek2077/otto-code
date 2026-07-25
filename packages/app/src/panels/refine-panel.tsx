import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { RotateCw, WandStars } from "@/components/icons/material-icons";
import { DiffViewer } from "@/components/diff-viewer";
import { TreeChevron } from "@/components/tree-primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TextArea } from "@/components/ui/text-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { splitPath } from "@/editor/code-results/result-rows";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useRefineFeature } from "@/refine/use-refine-feature";
import {
  useRefineSession,
  type RefinePhase,
  type RefineSession,
  type RefineWriteOutcome,
} from "@/refine/use-refine-session";
import {
  REFINE_PRESETS,
  findRefinePreset,
  isRefineInstructionValid,
  type RefinePreset,
} from "@/refine/refine-presets";
import { buildRefineWorkingSet } from "@/refine/refine-working-set";
import type { RefineFileProposal, RefineSetFile, RefineSetStats } from "@/refine/refine-set";
import type { RefineHunk } from "@/refine/hunks";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { compactFont, compactUp, useIconSize, type Theme } from "@/styles/theme";

/**
 * An AI rewrite as an auditable job — the document half of what the rename tab
 * does for symbols.
 *
 * The shape is the same on purpose: the request is taken from the file, set up
 * as a job in its own tab, and the full result — every change it would make,
 * across every file — is shown before anything happens. Impact first, action
 * second. Nothing is written until Accept, and Accept is a conditional write
 * per file against the identity the session pinned, so a file that changed
 * underneath comes back as a refusal rather than an overwrite.
 *
 * Two things are different from rename, and both are why this is not a dialog:
 *
 * - The job is **iterative**: the answer is a proposal you argue with. The
 *   instruction bar stays live under the header, because refining again is the
 *   main gesture, not an escape hatch, and every round re-diffs against the
 *   same pinned bases so five rounds of "tighten it further" cannot hide drift.
 * - The job **spans files**. The working-set strip is the blast radius, made
 *   editable: a file marked read-only goes to the model as context and can
 *   never come back as an edit.
 *
 * Strings are literal English pending the pre-release i18n sweep.
 */

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedInstructionInput = withUnistyles(TextArea, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

type RefineTarget = Extract<WorkspaceTabTarget, { kind: "refine" }>;

function useRefinePanelDescriptor(target: RefineTarget): PanelDescriptor {
  const { tail } = splitPath(target.paths[0] ?? "");
  const extra = target.paths.length - 1;
  return {
    label: `Refine: ${tail}`,
    subtitle:
      extra > 0
        ? `+${extra} more ${extra === 1 ? "file" : "files"}`
        : (findRefinePreset(target.presetId)?.label ?? "AI rewrite"),
    titleState: "ready",
    icon: WandStars,
    statusBucket: null,
  };
}

function RefinePanel() {
  const { serverId, workspaceId, target, closeCurrentTab } = usePaneContext();
  invariant(target.kind === "refine", "RefinePanel requires refine target");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const hasRefine = useRefineFeature(serverId);

  const files = useMemo(
    () =>
      buildRefineWorkingSet({
        paths: target.paths,
        ...(target.references ? { references: target.references } : {}),
        workspaceRoot: cwd ?? null,
      }),
    [cwd, target.paths, target.references],
  );

  const session = useRefineSession({
    serverId,
    cwd: cwd ?? "",
    files,
    enabled: hasRefine && Boolean(cwd),
  });

  const preset = useMemo(() => findRefinePreset(target.presetId), [target.presetId]);
  const [instruction, setInstruction] = useState(() => preset?.instruction ?? "");
  const [activePresetId, setActivePresetId] = useState<string | null>(preset?.id ?? null);

  const applyPreset = useCallback((next: RefinePreset) => {
    setInstruction(next.instruction);
    setActivePresetId(next.id);
  }, []);

  const editInstruction = useCallback((next: string) => {
    setInstruction(next);
    // Once the text is the user's, the preset is only a description of where it
    // started — so stop claiming the tab is running that preset.
    setActivePresetId(null);
  }, []);

  const activePreset = useMemo(
    () => (activePresetId ? findRefinePreset(activePresetId) : null),
    [activePresetId],
  );

  if (!hasRefine) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>Update the host to use Refine.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="refine-pane">
      <RefineHeader session={session} activePreset={activePreset} onClose={closeCurrentTab} />
      <WorkingSetStrip session={session} />
      <InstructionBar
        instruction={instruction}
        onChangeInstruction={editInstruction}
        onPickPreset={applyPreset}
        session={session}
      />
      <RefineBody session={session} />
    </View>
  );
}

/**
 * The one line that answers "what is this tab telling me", and the single
 * action slot whose meaning follows the phase. Accept is only ever live against
 * proposals that are on screen with at least one change kept — accepting
 * nothing would write the files back exactly as they were, which is a no-op
 * dressed up as a decision.
 */
function RefineHeader({
  session,
  activePreset,
  onClose,
}: {
  session: RefineSession;
  activePreset: RefinePreset | null;
  onClose: () => void;
}) {
  const iconSize = useIconSize();
  const { phase, stats, files } = session;
  const primaryLabel = files[0]?.label ?? "";
  const { head, tail } = useMemo(() => splitPath(primaryLabel), [primaryLabel]);
  const isFinished = phase.kind === "accepted" || phase.kind === "partiallyAccepted";

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Text style={styles.fileName} numberOfLines={1}>
          {tail}
        </Text>
        <Text style={styles.fileDir} numberOfLines={1}>
          {head}
        </Text>
        <View style={styles.spacer} />
        {phase.kind === "reviewing" ? (
          <>
            <KeepControls session={session} />
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                accessibilityRole="button"
                accessibilityLabel="Discard this proposal"
                onPress={session.repin}
                style={styles.iconButton}
                testID="refine-discard"
              >
                <ThemedRotateCw size={iconSize.sm} uniProps={mutedColorMapping} />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <Text style={styles.tooltipText}>
                  Discard this proposal and re-read every file — back to a blank session
                </Text>
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
        {isFinished ? null : (
          <Button variant="ghost" size="sm" onPress={onClose} testID="refine-abandon">
            Abandon
          </Button>
        )}
        <RefineAction session={session} onClose={onClose} />
      </View>
      <Text style={styles.impactText} testID="refine-impact">
        {summarizePhase(phase, stats)}
      </Text>
      {activePreset ? <Text style={styles.presetNote}>{activePreset.description}</Text> : null}
      {session.error ? (
        <Text style={styles.errorText} testID="refine-error">
          {session.error}
        </Text>
      ) : null}
    </View>
  );
}

function RefineAction({ session, onClose }: { session: RefineSession; onClose: () => void }) {
  const { phase, stats } = session;
  if (phase.kind === "accepted" || phase.kind === "partiallyAccepted") {
    return (
      <Button variant="default" size="sm" onPress={onClose} testID="refine-close">
        Close
      </Button>
    );
  }
  return (
    <Button
      variant="default"
      size="sm"
      onPress={session.accept}
      disabled={phase.kind !== "reviewing" || stats.changedFiles === 0}
      loading={phase.kind === "accepting"}
      testID="refine-accept"
    >
      {phase.kind === "accepting" ? "Writing…" : acceptLabel(stats)}
    </Button>
  );
}

/** Multi-file accept says how many files it is about to touch, before it does. */
function acceptLabel(stats: RefineSetStats): string {
  return stats.changedFiles > 1 ? `Accept · ${stats.changedFiles} files` : "Accept";
}

/** Keep/drop everything at once — the fast path for "all of it" or "none of it". */
function KeepControls({ session }: { session: RefineSession }) {
  const { stats } = session;
  const allKept = stats.totalHunks > 0 && stats.keptHunks === stats.totalHunks;
  const onPress = allKept ? session.dropAll : session.keepAll;
  return (
    <Button variant="ghost" size="sm" onPress={onPress} testID="refine-toggle-all">
      {allKept ? "Drop all" : "Keep all"}
    </Button>
  );
}

/**
 * The working set, and which of it may be written.
 *
 * This strip is the blast radius made visible and editable. A model that can
 * see a file but not change it is the difference between "understand this in
 * the context of the project" and "let it loose on the project" — too important
 * to leave implicit, so every file in the session is listed with its role, and
 * the role is one tap from changing.
 */
function WorkingSetStrip({ session }: { session: RefineSession }) {
  const { files, phase } = session;
  const busy = phase.kind === "generating" || phase.kind === "accepting";
  const finished = phase.kind === "accepted" || phase.kind === "partiallyAccepted";
  if (files.length <= 1 || finished) {
    return null;
  }
  const writable = files.filter((file) => file.writable).length;
  return (
    <View style={styles.workingSet} testID="refine-working-set">
      <Text style={styles.workingSetLabel}>
        {writable} of {files.length} files may be rewritten; the rest are read-only context.
      </Text>
      <View style={styles.workingSetRow}>
        {files.map((file) => (
          <WorkingSetChip
            key={file.id}
            file={file}
            disabled={busy}
            onToggle={session.setWritable}
          />
        ))}
      </View>
    </View>
  );
}

function WorkingSetChip({
  file,
  disabled,
  onToggle,
}: {
  file: RefineSetFile;
  disabled: boolean;
  onToggle: (fileId: string, writable: boolean) => void;
}) {
  const handlePress = useCallback(
    () => onToggle(file.id, !file.writable),
    [file.id, file.writable, onToggle],
  );
  const chipStyle = useMemo(
    () => [styles.chip, file.writable ? styles.chipWritable : styles.chipReference],
    [file.writable],
  );
  const checkedState = useMemo(() => ({ checked: file.writable }), [file.writable]);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={file.label}
        accessibilityState={checkedState}
        onPress={handlePress}
        disabled={disabled}
        style={chipStyle}
        testID={`refine-set-${file.id}`}
      >
        <Text style={file.writable ? styles.chipLabelWritable : styles.chipLabel} numberOfLines={1}>
          {file.label}
        </Text>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>
          {file.writable
            ? "May be rewritten. Tap to make it read-only context instead."
            : "Read-only context — the model reads it but can never change it. Tap to allow rewriting."}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The instruction is the loop, so it stays on screen through every phase rather
 * than being a dialog you dismiss. Re-running with a different instruction is
 * the whole point of Refine over a one-shot rewrite.
 */
function InstructionBar({
  instruction,
  onChangeInstruction,
  onPickPreset,
  session,
}: {
  instruction: string;
  onChangeInstruction: (next: string) => void;
  onPickPreset: (preset: RefinePreset) => void;
  session: RefineSession;
}) {
  const isCompact = useIsCompactFormFactor();
  const { phase } = session;
  const busy = phase.kind === "generating";
  const ready = phase.kind === "idle" || phase.kind === "reviewing";
  const canRun = ready && isRefineInstructionValid(instruction);
  const run = useCallback(() => session.run(instruction), [instruction, session]);
  const startOver = useCallback(() => session.startOver(instruction), [instruction, session]);

  if (
    phase.kind === "accepted" ||
    phase.kind === "partiallyAccepted" ||
    phase.kind === "unreadable"
  ) {
    return null;
  }

  return (
    <View style={styles.instructionBar}>
      <View style={styles.presetRow}>
        {REFINE_PRESETS.map((preset) => (
          <PresetChip key={preset.id} preset={preset} onPress={onPickPreset} disabled={busy} />
        ))}
      </View>
      <View style={isCompact ? styles.instructionColumn : styles.instructionRow}>
        <ThemedInstructionInput
          style={styles.instructionInput}
          value={instruction}
          onChangeText={onChangeInstruction}
          placeholder="What should change? e.g. keep every rule, cut the repetition"
          editable={!busy}
          testID="refine-instruction"
        />
        <View style={styles.instructionActions}>
          <Button
            variant="default"
            size="sm"
            onPress={run}
            disabled={!canRun}
            loading={busy}
            testID="refine-run"
          >
            {runLabel(phase)}
          </Button>
          {phase.kind === "reviewing" ? (
            <Button
              variant="outline"
              size="sm"
              onPress={startOver}
              disabled={!canRun}
              testID="refine-start-over"
            >
              Start over
            </Button>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** "Refine" the first time, "Refine again" once there is something to argue with. */
function runLabel(phase: RefinePhase): string {
  if (phase.kind === "generating") {
    return "Refining…";
  }
  return phase.kind === "reviewing" ? "Refine again" : "Refine";
}

function PresetChip({
  preset,
  onPress,
  disabled,
}: {
  preset: RefinePreset;
  onPress: (preset: RefinePreset) => void;
  disabled: boolean;
}) {
  const handlePress = useCallback(() => onPress(preset), [onPress, preset]);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={preset.label}
        onPress={handlePress}
        disabled={disabled}
        style={styles.chip}
        testID={`refine-preset-${preset.id}`}
      >
        <Text style={styles.chipLabel}>{preset.label}</Text>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{preset.description}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function RefineBody({ session }: { session: RefineSession }) {
  const { phase, proposals } = session;

  if (phase.kind === "pinning") {
    return <CenteredNote text="Reading the files…" />;
  }
  if (phase.kind === "unreadable") {
    return <CenteredNote text={phase.reason} tone="error" />;
  }
  if (phase.kind === "accepted" || phase.kind === "partiallyAccepted") {
    return <WriteReport outcomes={phase.outcomes} />;
  }
  if (phase.kind === "generating" && proposals.length === 0) {
    return <CenteredNote text="Working out a rewrite…" />;
  }
  if (proposals.length === 0) {
    return (
      <CenteredNote text="Say what should change, then press Refine. Nothing is written until you accept it." />
    );
  }
  return <ProposalList session={session} />;
}

function ProposalList({ session }: { session: RefineSession }) {
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
        {session.proposals.map((proposal) => (
          <FileProposalGroup key={proposal.id} proposal={proposal} session={session} />
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * One file's proposal: a heading that can keep or drop the whole file at once,
 * and its changes underneath. The two-level shape mirrors the rename tab's
 * file-then-edit list, because it answers the same question in the same order —
 * which files, then what inside them.
 */
function FileProposalGroup({
  proposal,
  session,
}: {
  proposal: RefineFileProposal;
  session: RefineSession;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((current) => !current), []);
  const foldState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const { head, tail } = useMemo(() => splitPath(proposal.label), [proposal.label]);
  const keptCount = proposal.diff.hunks.filter((hunk) =>
    session.isKept(proposal.id, hunk.id),
  ).length;
  const allKept = keptCount === proposal.diff.hunks.length;
  const toggleFile = useCallback(
    () => session.setFileKept(proposal.id, !allKept),
    [allKept, proposal.id, session],
  );

  return (
    <View style={styles.fileGroup} testID="refine-file">
      <View style={styles.fileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={foldState}
          accessibilityLabel={proposal.label}
          onPress={toggleCollapsed}
          style={styles.fileHeading}
          testID="refine-file-fold"
        >
          <TreeChevron expanded={!collapsed} />
          <Text style={styles.fileGroupName} numberOfLines={1}>
            {tail}
          </Text>
          <Text style={styles.fileGroupDir} numberOfLines={1}>
            {head}
          </Text>
        </Pressable>
        <View style={styles.spacer} />
        <Text style={styles.groupCount}>
          {keptCount}/{proposal.diff.hunks.length}
        </Text>
        <Button variant="ghost" size="sm" onPress={toggleFile} testID="refine-file-toggle">
          {allKept ? "Drop file" : "Keep file"}
        </Button>
      </View>
      {collapsed
        ? null
        : proposal.diff.hunks.map((hunk, index) => (
            <HunkGroup
              key={hunk.id}
              fileId={proposal.id}
              hunk={hunk}
              ordinal={index + 1}
              kept={session.isKept(proposal.id, hunk.id)}
              onToggle={session.toggleHunk}
            />
          ))}
    </View>
  );
}

/**
 * One change, with its decision.
 *
 * The switch is the decision and the chevron is the folding — separate
 * controls, because a group you have folded away is not a group you have
 * dropped, and conflating them would make "I've read this one" destructive. A
 * dropped group stays on screen, dimmed: what you refused is part of the
 * picture of what the model wanted to do.
 */
function HunkGroup({
  fileId,
  hunk,
  ordinal,
  kept,
  onToggle,
}: {
  fileId: string;
  hunk: RefineHunk;
  ordinal: number;
  kept: boolean;
  onToggle: (fileId: string, hunkId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((current) => !current), []);
  const toggleKept = useCallback(() => onToggle(fileId, hunk.id), [fileId, hunk.id, onToggle]);
  const bodyStyle = useMemo(() => [styles.hunkBody, !kept && styles.hunkBodyDropped], [kept]);
  const foldState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={styles.group} testID="refine-hunk">
      <View style={styles.groupHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={foldState}
          accessibilityLabel={`Change ${ordinal}`}
          onPress={toggleCollapsed}
          style={styles.groupHeading}
          testID="refine-hunk-fold"
        >
          <TreeChevron expanded={!collapsed} />
          <Text style={styles.groupName}>Change {ordinal}</Text>
          <Text style={styles.groupCount}>
            +{hunk.additions} −{hunk.removals}
          </Text>
        </Pressable>
        <View style={styles.spacer} />
        <Text style={kept ? styles.decisionKept : styles.decisionDropped}>
          {kept ? "Keeping" : "Dropped"}
        </Text>
        <Switch
          value={kept}
          onValueChange={toggleKept}
          accessibilityLabel={`Keep change ${ordinal}`}
          testID="refine-hunk-keep"
        />
      </View>
      {collapsed ? null : (
        <View style={bodyStyle}>
          <DiffViewer diffLines={hunk.lines} />
        </View>
      )}
    </View>
  );
}

/**
 * What the accept actually did, file by file.
 *
 * Every file is listed, including the ones that went cleanly — a report showing
 * only problems would leave the user unable to tell "nothing went wrong" from
 * "nothing ran". The `stale` row is the important one: that file changed
 * underneath the session, so it was deliberately left exactly as it is.
 */
function WriteReport({ outcomes }: { outcomes: RefineWriteOutcome[] }) {
  return (
    <View style={styles.listHost}>
      <ScrollView style={styles.listScroll}>
        {outcomes.map((outcome) => (
          <View key={outcome.label} style={styles.outcomeRow} testID="refine-outcome">
            <View style={styles.outcomeHead}>
              <View style={styles[OUTCOME_DOT[outcome.kind]]} />
              <Text style={styles.fileGroupName} numberOfLines={1}>
                {outcome.label}
              </Text>
              <View style={styles.spacer} />
              <Text style={styles[OUTCOME_TEXT[outcome.kind]]}>{OUTCOME_STATUS[outcome.kind]}</Text>
            </View>
            {outcome.reason ? (
              <Text style={styles.outcomeReason} numberOfLines={2}>
                {outcome.reason}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const OUTCOME_DOT = { written: "dotGood", stale: "dotWarn", failed: "dotBad" } as const;
const OUTCOME_TEXT = { written: "statusGood", stale: "statusWarn", failed: "statusBad" } as const;
const OUTCOME_STATUS = {
  written: "written",
  stale: "left as it is",
  failed: "could not write",
} as const;

function CenteredNote({ text, tone = "muted" }: { text: string; tone?: "muted" | "error" }) {
  return (
    <View style={styles.centered}>
      <Text style={tone === "error" ? styles.errorText : styles.mutedText}>{text}</Text>
    </View>
  );
}

/** The one line that answers "what is this tab telling me" for every phase. */
export function summarizePhase(phase: RefinePhase, stats: RefineSetStats): string {
  if (phase.kind === "pinning") {
    return "Pinning the files as they are now — that is what every proposal will be measured against.";
  }
  if (phase.kind === "unreadable") {
    return "This working set could not be read.";
  }
  if (phase.kind === "idle") {
    return "Nothing proposed yet. No file has been touched.";
  }
  if (phase.kind === "generating") {
    return `Round ${phase.round} — rewriting.`;
  }
  if (phase.kind === "accepting") {
    return "Writing the kept changes.";
  }
  if (phase.kind === "accepted") {
    const written = phase.outcomes.length;
    return `Done — ${written} ${written === 1 ? "file" : "files"} written.`;
  }
  if (phase.kind === "partiallyAccepted") {
    const written = phase.outcomes.filter((outcome) => outcome.kind === "written").length;
    const skipped = phase.outcomes.length - written;
    return `${written} written, ${skipped} left alone. Nothing was overwritten.`;
  }
  return summarizeReview(phase.round, stats);
}

function summarizeReview(round: number, stats: RefineSetStats): string {
  const changes = `${stats.keptHunks} of ${stats.totalHunks} ${
    stats.totalHunks === 1 ? "change" : "changes"
  } kept`;
  const scope =
    stats.proposedFiles > 1 ? ` across ${stats.changedFiles}/${stats.proposedFiles} files` : "";
  return `Round ${round} — ${changes}${scope}, +${stats.additions} −${stats.removals} lines. Nothing has been written yet.`;
}

export const refinePanelRegistration: PanelRegistration<"refine"> = {
  kind: "refine",
  component: RefinePanel,
  useDescriptor: useRefinePanelDescriptor,
  confirmClose() {
    // Abandoning is free — no file was touched — so closing never asks.
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.background,
  },
  header: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  spacer: {
    flex: 1,
  },
  fileName: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: "600",
    flexShrink: 0,
  },
  fileDir: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.xs),
    flexShrink: 1,
  },
  impactText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  presetNote: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontStyle: "italic",
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
    width: compactUp(26, 1.5),
    height: compactUp(26, 1.5),
    borderRadius: theme.borderRadius.sm,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    maxWidth: 280,
  },
  workingSet: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  workingSetLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  workingSetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  instructionBar: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: compactUp(3),
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    maxWidth: 260,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  chipWritable: {
    borderColor: theme.colors.accent,
  },
  chipReference: {
    borderStyle: "dashed",
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  chipLabelWritable: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  instructionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  instructionColumn: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  instructionInput: {
    flex: 1,
    minHeight: compactUp(56),
    maxHeight: compactUp(140),
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
  },
  instructionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  listHost: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  listScroll: {
    flex: 1,
  },
  fileGroup: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
  },
  fileHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  fileGroupName: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: "600",
    flexShrink: 0,
  },
  fileGroupDir: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    flexShrink: 1,
  },
  group: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
  },
  groupHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  groupName: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
    fontWeight: "600",
  },
  groupCount: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  decisionKept: {
    color: theme.colors.statusSuccess,
    fontSize: compactFont(theme.fontSize.xs),
  },
  decisionDropped: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
  },
  hunkBody: {
    backgroundColor: theme.colors.surface0,
  },
  // A refused change stays visible but recedes: it is context for the decision,
  // not something you are still being asked about.
  hunkBodyDropped: {
    opacity: 0.45,
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
  outcomeReason: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    paddingLeft: theme.spacing[3],
  },
  dotGood: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusSuccess },
  dotWarn: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusWarning },
  dotBad: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.statusDanger },
  statusGood: { color: theme.colors.statusSuccess, fontSize: compactFont(theme.fontSize.xs) },
  statusWarn: { color: theme.colors.statusWarning, fontSize: compactFont(theme.fontSize.xs) },
  statusBad: { color: theme.colors.statusDanger, fontSize: compactFont(theme.fontSize.xs) },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
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
}));
