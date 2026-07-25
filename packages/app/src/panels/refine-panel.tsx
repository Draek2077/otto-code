import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import {
  Check,
  CheckSquare,
  Compress,
  RotateCw,
  WandStars,
  X,
} from "@/components/icons/material-icons";
import { DiffViewer } from "@/components/diff-viewer";
import { TreeChevron } from "@/components/tree-primitives";
import { Button } from "@/components/ui/button";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { Switch } from "@/components/ui/switch";
import { TextAreaScrollFrame } from "@/components/ui/text-area";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import {
  CodeResultExpandToggle,
  CodeResultGroupHeader,
  splitPath,
  useCollapsedGroups,
} from "@/editor/code-results/result-rows";
import { i18n } from "@/i18n/i18next";
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
  refineJobFor,
  refinePresetDescription,
  refinePresetLabel,
  type RefineJobKind,
  type RefinePreset,
} from "@/refine/refine-presets";
import { buildRefineWorkingSet } from "@/refine/refine-working-set";
import type { RefineFileProposal, RefineSetFile, RefineSetStats } from "@/refine/refine-set";
import type { RefineHunk } from "@/refine/hunks";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { compactFont, type Theme } from "@/styles/theme";

/**
 * An AI rewrite as an auditable job — the document half of what the rename tab
 * does for symbols.
 *
 * The shape is the same on purpose, down to the chrome: one toolbar at the file
 * editor's exact height, icon buttons with their labels in tooltips, and a
 * single accent-tinted action slot whose meaning follows the phase. These tabs
 * open beside the editor in a split, so a bar built out of text buttons stands
 * taller than the one next to it and reads as a mistake in the split rather
 * than as a different panel.
 *
 * Impact first, action second. Nothing is written until Accept, and Accept is a
 * conditional write per file against the identity the session pinned, so a file
 * that changed underneath comes back as a refusal rather than an overwrite.
 *
 * Two things are different from rename, and both are why this is not a dialog:
 *
 * - The job is **iterative**: the answer is a proposal you argue with. The
 *   instruction bar stays live under the toolbar, because refining again is the
 *   main gesture, not an escape hatch, and every round re-diffs against the
 *   same pinned bases so five rounds of "tighten it further" cannot hide drift.
 * - The job **spans files**. The working-set strip is the blast radius, made
 *   editable: a file marked read-only goes to the model as context and can
 *   never come back as an edit.
 */

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);
const ThemedCheckSquare = withUnistyles(CheckSquare);
// The field, not the `TextArea` wrapper. `withUnistyles` applies a wrapped
// component's style through a `.hash > *` child selector, so wrapping a
// composite lands the style on its outer frame and the real `<textarea>` keeps
// the browser's defaults — which is how this box shipped with black 16px text
// on a dark panel. See docs/unistyles.md.
const ThemedInstructionInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

type RefineTarget = Extract<WorkspaceTabTarget, { kind: "refine" }>;

/**
 * The tab names itself after the job it was opened for, not after the module
 * that implements it. Compaction and a plain rewrite are the same loop, but a
 * user who pressed "Compact with AI" and got a tab called "Refine" has to work
 * out that those are the same thing — so the title and the glyph follow the
 * preset, exactly as the toolbar button that opened it does.
 */
function useRefinePanelDescriptor(target: RefineTarget): PanelDescriptor {
  const { tail } = splitPath(target.paths[0] ?? "");
  const extra = target.paths.length - 1;
  const job = refineJobFor(target.presetId);
  const preset = findRefinePreset(target.presetId);
  return {
    label: i18n.t("refine.tab.title", { job: jobTitle(job), file: tail }),
    subtitle: describeExtraFiles(extra, preset),
    titleState: "ready",
    icon: job === "compact" ? Compress : WandStars,
    statusBucket: null,
  };
}

/** The tab's second line: how much more it covers, or what it was opened for. */
function describeExtraFiles(extra: number, preset: RefinePreset | null): string {
  if (extra === 1) {
    return i18n.t("refine.tab.moreFile", { count: extra });
  }
  if (extra > 1) {
    return i18n.t("refine.tab.moreFiles", { count: extra });
  }
  return preset ? refinePresetLabel(preset) : i18n.t("refine.tab.fallbackSubtitle");
}

function jobTitle(job: RefineJobKind): string {
  return job === "compact" ? i18n.t("refine.job.compact") : i18n.t("refine.job.refine");
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
  const job = preset?.job ?? "refine";
  const [instruction, setInstruction] = useState(() => preset?.instruction ?? "");
  const [activePresetId, setActivePresetId] = useState<string | null>(preset?.id ?? null);

  const groups = useCollapsedGroups();
  const { allExpanded, toggleAll } = groups;
  const proposalIds = useMemo(
    () => session.proposals.map((proposal) => proposal.id),
    [session.proposals],
  );
  const toggleEverything = useCallback(() => toggleAll(proposalIds), [proposalIds, toggleAll]);

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
        <Text style={styles.mutedText}>{i18n.t("refine.unsupported")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="refine-pane">
      <RefineToolbar
        session={session}
        allExpanded={allExpanded(proposalIds)}
        onToggleAll={toggleEverything}
        onClose={closeCurrentTab}
      />
      {session.error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} testID="refine-error">
            {session.error}
          </Text>
        </View>
      ) : null}
      <WorkingSetStrip session={session} />
      <InstructionBar
        instruction={instruction}
        activePreset={activePreset}
        job={job}
        onChangeInstruction={editInstruction}
        onPickPreset={applyPreset}
        session={session}
      />
      <RefineBody session={session} groups={groups} job={job} />
    </View>
  );
}

/**
 * One row, at the file editor's exact toolbar height: what this job is about,
 * what it would do, and the controls that decide it.
 *
 * Accept is only ever live against proposals that are on screen with at least
 * one change kept — accepting nothing would write the files back exactly as
 * they were, which is a no-op dressed up as a decision. There is no Abandon
 * button because abandoning is free and the tab already has a close control;
 * spending toolbar width on a second way to do nothing would crowd out the
 * decisions that cost something.
 */
function RefineToolbar({
  session,
  allExpanded,
  onToggleAll,
  onClose,
}: {
  session: RefineSession;
  allExpanded: boolean;
  onToggleAll: () => void;
  onClose: () => void;
}) {
  const { phase, stats, files } = session;
  const primaryLabel = files[0]?.label ?? "";
  const { head, tail } = useMemo(() => splitPath(primaryLabel), [primaryLabel]);
  const isReviewing = phase.kind === "reviewing";
  const isFinished = phase.kind === "accepted" || phase.kind === "partiallyAccepted";

  return (
    <View style={styles.toolbar}>
      <Text style={styles.fileName} numberOfLines={1}>
        {tail}
      </Text>
      <Text style={styles.fileDir} numberOfLines={1}>
        {head}
      </Text>
      <Text style={styles.impactText} numberOfLines={1}>
        {summarizePhase(phase, stats)}
      </Text>
      <View style={styles.spacer} />
      {isReviewing ? (
        <>
          <CodeResultExpandToggle
            allExpanded={allExpanded}
            onToggle={onToggleAll}
            testID="refine-toggle-expand-all"
          />
          <KeepAllToggle session={session} />
        </>
      ) : null}
      {isFinished ? null : (
        <ToolbarIconButton
          label={i18n.t("refine.toolbar.discard")}
          Icon={ThemedRotateCw}
          onPress={session.repin}
          disabled={phase.kind === "generating" || phase.kind === "accepting"}
          testID="refine-discard"
        />
      )}
      <RefineAction session={session} onClose={onClose} />
    </View>
  );
}

/**
 * One action slot, whose meaning follows the phase. A toolbar showing Accept and
 * Close at once would be asking the user to work out which one is live.
 */
function RefineAction({ session, onClose }: { session: RefineSession; onClose: () => void }) {
  const { phase, stats } = session;
  if (phase.kind === "accepted" || phase.kind === "partiallyAccepted") {
    return (
      <ToolbarIconButton
        label={i18n.t("common.actions.close")}
        Icon={ThemedX}
        tone="accent"
        onPress={onClose}
        testID="refine-close"
      />
    );
  }
  return (
    <ToolbarIconButton
      label={acceptLabel(phase, stats)}
      Icon={ThemedCheck}
      tone="accent"
      onPress={session.accept}
      disabled={phase.kind !== "reviewing" || stats.changedFiles === 0}
      loading={phase.kind === "accepting"}
      testID="refine-accept"
    />
  );
}

/** Multi-file accept says how many files it is about to touch, before it does. */
function acceptLabel(phase: RefinePhase, stats: RefineSetStats): string {
  if (phase.kind === "accepting") {
    return i18n.t("refine.toolbar.writing");
  }
  return stats.changedFiles > 1
    ? i18n.t("refine.toolbar.acceptMany", { count: stats.changedFiles })
    : i18n.t("refine.toolbar.acceptOne");
}

/**
 * Keep or drop everything at once — the fast path for "all of it" or "none of
 * it". One button rather than two, like the expand toggle beside it: the list
 * is either all kept or it isn't, so only one of the two actions is ever the
 * one you want, and the highlight carries which state you are in.
 */
function KeepAllToggle({ session }: { session: RefineSession }) {
  const { stats } = session;
  const allKept = stats.totalHunks > 0 && stats.keptHunks === stats.totalHunks;
  return (
    <ToolbarIconButton
      label={allKept ? i18n.t("refine.toolbar.dropAll") : i18n.t("refine.toolbar.keepAll")}
      Icon={ThemedCheckSquare}
      onPress={allKept ? session.dropAll : session.keepAll}
      selected={allKept}
      testID="refine-toggle-all"
    />
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
 *
 * Shown for a set of one too. A single-file rewrite is not a different feature
 * with different controls, it is this one with nothing added — and a tab whose
 * chrome appears and disappears depending on how it was opened teaches the user
 * that Refine and Compact are two tools when they are one.
 */
function WorkingSetStrip({ session }: { session: RefineSession }) {
  const { files, phase } = session;
  const busy = phase.kind === "generating" || phase.kind === "accepting";
  const finished = phase.kind === "accepted" || phase.kind === "partiallyAccepted";
  if (files.length === 0 || finished) {
    return null;
  }
  const writable = files.filter((file) => file.writable).length;
  return (
    <View style={styles.workingSet} testID="refine-working-set">
      <Text style={styles.stripLabel}>{describeWorkingSet(writable, files.length)}</Text>
      <View style={styles.chipRow}>
        {files.length > 1 ? (
          <AllFilesChip
            allWritable={writable === files.length}
            disabled={busy}
            onToggle={session.setAllWritable}
          />
        ) : null}
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

function describeWorkingSet(writable: number, total: number): string {
  if (total === 1) {
    return i18n.t("refine.workingSet.single");
  }
  if (writable === total) {
    return i18n.t("refine.workingSet.allWritable", { count: total });
  }
  return i18n.t("refine.workingSet.someWritable", { writable, total });
}

/**
 * Widen the rewrite to the whole set in one press, and back again.
 *
 * A compaction seeded from the context graph arrives with a dozen references,
 * and "actually, rewrite all of these" is a real request — one that costs a
 * dozen taps without this. Going back leaves the primary rewritable rather than
 * emptying the set, because a set with nothing to rewrite is a round that
 * cannot run.
 */
function AllFilesChip({
  allWritable,
  disabled,
  onToggle,
}: {
  allWritable: boolean;
  disabled: boolean;
  onToggle: (writable: boolean) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onToggle(!allWritable), [allWritable, onToggle]);
  const chipStyle = useMemo(
    () => [styles.chip, allWritable ? styles.chipWritable : null],
    [allWritable],
  );
  const checkedState = useMemo(() => ({ checked: allWritable }), [allWritable]);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={t("refine.workingSet.allChipLabel")}
        accessibilityState={checkedState}
        onPress={handlePress}
        disabled={disabled}
        style={chipStyle}
        testID="refine-set-all"
      >
        <Text style={allWritable ? styles.chipLabelWritable : styles.chipLabel}>
          {t("refine.workingSet.allChipText")}
        </Text>
      </TooltipTrigger>
      <TooltipContent side="bottom" maxWidth={360}>
        <Text style={styles.tooltipText}>
          {allWritable ? t("refine.workingSet.allOnHint") : t("refine.workingSet.allOffHint")}
        </Text>
      </TooltipContent>
    </Tooltip>
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
  const { t } = useTranslation();
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
      <TooltipContent side="bottom" maxWidth={360}>
        <Text style={styles.tooltipText}>
          {file.writable
            ? t("refine.workingSet.writableHint")
            : t("refine.workingSet.referenceHint")}
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
  activePreset,
  job,
  onChangeInstruction,
  onPickPreset,
  session,
}: {
  instruction: string;
  activePreset: RefinePreset | null;
  job: RefineJobKind;
  onChangeInstruction: (next: string) => void;
  onPickPreset: (preset: RefinePreset) => void;
  session: RefineSession;
}) {
  const { t } = useTranslation();
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
      <View style={styles.chipRow}>
        {REFINE_PRESETS.map((preset) => (
          <PresetChip
            key={preset.id}
            preset={preset}
            active={activePreset?.id === preset.id}
            onPress={onPickPreset}
            disabled={busy}
          />
        ))}
      </View>
      <View style={isCompact ? styles.instructionColumn : styles.instructionRow}>
        {/* The frame is a plain wrapper with no flex of its own, so the field
            gets its width from this box rather than from the row directly. */}
        <View style={styles.instructionField}>
          <TextAreaScrollFrame>
            <ThemedInstructionInput
              multiline
              textAlignVertical="top"
              style={styles.instructionInput}
              value={instruction}
              onChangeText={onChangeInstruction}
              placeholder={t("refine.instruction.placeholder")}
              editable={!busy}
              testID="refine-instruction"
            />
          </TextAreaScrollFrame>
        </View>
        <View style={styles.instructionActions}>
          <Button
            variant="default"
            size="sm"
            onPress={run}
            disabled={!canRun}
            loading={busy}
            testID="refine-run"
          >
            {runLabel(phase, job)}
          </Button>
          {phase.kind === "reviewing" ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={startOver}
              disabled={!canRun}
              testID="refine-start-over"
            >
              {t("refine.instruction.startOver")}
            </Button>
          ) : null}
        </View>
      </View>
      {activePreset ? (
        <Text style={styles.presetNote}>{refinePresetDescription(activePreset)}</Text>
      ) : null}
    </View>
  );
}

/** The job's own verb, then "again" once there is something to argue with. */
function runLabel(phase: RefinePhase, job: RefineJobKind): string {
  if (phase.kind === "generating") {
    return job === "compact"
      ? i18n.t("refine.instruction.compacting")
      : i18n.t("refine.instruction.refining");
  }
  const verb = jobTitle(job);
  return phase.kind === "reviewing" ? i18n.t("refine.instruction.again", { job: verb }) : verb;
}

function PresetChip({
  preset,
  active,
  onPress,
  disabled,
}: {
  preset: RefinePreset;
  active: boolean;
  onPress: (preset: RefinePreset) => void;
  disabled: boolean;
}) {
  const handlePress = useCallback(() => onPress(preset), [onPress, preset]);
  const chipStyle = useMemo(() => [styles.chip, active ? styles.chipWritable : null], [active]);
  const selectedState = useMemo(() => ({ selected: active }), [active]);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={refinePresetLabel(preset)}
        accessibilityState={selectedState}
        onPress={handlePress}
        disabled={disabled}
        style={chipStyle}
        testID={`refine-preset-${preset.id}`}
      >
        <Text style={active ? styles.chipLabelWritable : styles.chipLabel}>
          {refinePresetLabel(preset)}
        </Text>
      </TooltipTrigger>
      <TooltipContent side="bottom" maxWidth={360}>
        <Text style={styles.tooltipText}>{refinePresetDescription(preset)}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function RefineBody({
  session,
  groups,
  job,
}: {
  session: RefineSession;
  groups: ReturnType<typeof useCollapsedGroups>;
  job: RefineJobKind;
}) {
  const { phase, proposals } = session;

  if (phase.kind === "pinning") {
    return <CenteredNote text={i18n.t("refine.body.pinning")} />;
  }
  if (phase.kind === "unreadable") {
    return <CenteredNote text={phase.reason} tone="error" />;
  }
  if (phase.kind === "accepted" || phase.kind === "partiallyAccepted") {
    return <WriteReport outcomes={phase.outcomes} />;
  }
  if (phase.kind === "generating" && proposals.length === 0) {
    return <CenteredNote text={i18n.t("refine.body.generating")} />;
  }
  if (proposals.length === 0) {
    return <CenteredNote text={i18n.t("refine.body.idle", { job: jobTitle(job) })} />;
  }
  return <ProposalList session={session} groups={groups} />;
}

function ProposalList({
  session,
  groups,
}: {
  session: RefineSession;
  groups: ReturnType<typeof useCollapsedGroups>;
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
        {session.proposals.map((proposal) => (
          <FileProposalGroup
            key={proposal.id}
            proposal={proposal}
            session={session}
            collapsed={groups.isCollapsed(proposal.id)}
            onToggleCollapsed={groups.toggle}
          />
        ))}
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * One file's proposal: the same heading the rename and references tabs use, so
 * the three read as one family, plus a switch that keeps or drops the whole
 * file at once. The two-level shape mirrors the rename tab's file-then-edit
 * list, because it answers the same question in the same order — which files,
 * then what inside them.
 */
function FileProposalGroup({
  proposal,
  session,
  collapsed,
  onToggleCollapsed,
}: {
  proposal: RefineFileProposal;
  session: RefineSession;
  collapsed: boolean;
  onToggleCollapsed: (id: string) => void;
}) {
  const keptCount = proposal.diff.hunks.filter((hunk) =>
    session.isKept(proposal.id, hunk.id),
  ).length;
  const allKept = keptCount === proposal.diff.hunks.length;
  const toggleFile = useCallback(
    () => session.setFileKept(proposal.id, !allKept),
    [allKept, proposal.id, session],
  );
  // The heading hands back the label it was given; the fold set is keyed by id,
  // which is what the rest of the session addresses a file by.
  const toggleCollapsed = useCallback(
    () => onToggleCollapsed(proposal.id),
    [onToggleCollapsed, proposal.id],
  );

  const trailing = useMemo(
    () => (
      <View style={styles.fileTrailing}>
        <Text style={styles.keptCount}>
          {i18n.t("refine.file.keptCount", { count: keptCount })}
        </Text>
        <Switch
          value={allKept}
          onValueChange={toggleFile}
          accessibilityLabel={i18n.t("refine.file.keepEveryChangeIn", { file: proposal.label })}
          testID="refine-file-toggle"
        />
      </View>
    ),
    [allKept, keptCount, proposal.label, toggleFile],
  );

  return (
    <View style={styles.fileGroup} testID="refine-file">
      <CodeResultGroupHeader
        path={proposal.label}
        count={proposal.diff.hunks.length}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        trailing={trailing}
        testID="refine-file-fold"
      />
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
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((current) => !current), []);
  const toggleKept = useCallback(() => onToggle(fileId, hunk.id), [fileId, hunk.id, onToggle]);
  const bodyStyle = useMemo(() => [styles.hunkBody, !kept && styles.hunkBodyDropped], [kept]);
  const foldState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <View style={styles.hunk} testID="refine-hunk">
      <Pressable
        accessibilityRole="button"
        accessibilityState={foldState}
        accessibilityLabel={t("refine.hunk.title", { ordinal })}
        onPress={toggleCollapsed}
        style={styles.hunkHeader}
        testID="refine-hunk-fold"
      >
        <TreeChevron expanded={!collapsed} />
        <Text style={styles.hunkName}>{t("refine.hunk.title", { ordinal })}</Text>
        <Text style={styles.hunkStat}>
          +{hunk.additions} −{hunk.removals}
        </Text>
        <View style={styles.spacer} />
        <Text style={kept ? styles.decisionKept : styles.decisionDropped}>
          {kept ? t("refine.hunk.keeping") : t("refine.hunk.dropped")}
        </Text>
        <Switch
          value={kept}
          onValueChange={toggleKept}
          accessibilityLabel={t("refine.hunk.keepAccessibility", { ordinal })}
          testID="refine-hunk-keep"
        />
      </Pressable>
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
          <OutcomeRow key={outcome.label} outcome={outcome} />
        ))}
      </ScrollView>
    </View>
  );
}

function OutcomeRow({ outcome }: { outcome: RefineWriteOutcome }) {
  const { head, tail } = useMemo(() => splitPath(outcome.label), [outcome.label]);

  return (
    <View style={styles.outcomeRow} testID="refine-outcome">
      <View style={styles.outcomeHead}>
        <View style={styles[OUTCOME_DOT[outcome.kind]]} />
        <Text style={styles.outcomeName} numberOfLines={1}>
          {tail}
        </Text>
        <Text style={styles.outcomeDir} numberOfLines={1}>
          {head}
        </Text>
        <View style={styles.spacer} />
        <Text style={styles[OUTCOME_TEXT[outcome.kind]]}>
          {i18n.t(OUTCOME_STATUS[outcome.kind])}
        </Text>
      </View>
      {outcome.reason ? (
        <Text style={styles.outcomeReason} numberOfLines={2}>
          {outcome.reason}
        </Text>
      ) : null}
    </View>
  );
}

const OUTCOME_DOT = { written: "dotGood", stale: "dotWarn", failed: "dotBad" } as const;
const OUTCOME_TEXT = { written: "statusGood", stale: "statusWarn", failed: "statusBad" } as const;
const OUTCOME_STATUS = {
  written: "refine.outcome.written",
  stale: "refine.outcome.stale",
  failed: "refine.outcome.failed",
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
    return i18n.t("refine.summary.pinning");
  }
  if (phase.kind === "unreadable") {
    return i18n.t("refine.summary.unreadable");
  }
  if (phase.kind === "idle") {
    return i18n.t("refine.summary.idle");
  }
  if (phase.kind === "generating") {
    return i18n.t("refine.summary.generating", { round: phase.round });
  }
  if (phase.kind === "accepting") {
    return i18n.t("refine.summary.accepting");
  }
  if (phase.kind === "accepted") {
    const written = phase.outcomes.length;
    return written === 1
      ? i18n.t("refine.summary.acceptedOne")
      : i18n.t("refine.summary.acceptedMany", { count: written });
  }
  if (phase.kind === "partiallyAccepted") {
    const written = phase.outcomes.filter((outcome) => outcome.kind === "written").length;
    const skipped = phase.outcomes.length - written;
    return i18n.t("refine.summary.partiallyAccepted", { written, skipped });
  }
  return summarizeReview(phase.round, stats);
}

/**
 * Four whole sentences rather than one assembled from fragments: "1 change kept
 * across 2/3 files" inflects differently in every locale we ship, and a
 * translator handed `{{count}} {{noun}} kept` cannot fix that.
 */
function summarizeReview(round: number, stats: RefineSetStats): string {
  const one = stats.totalHunks === 1;
  const key =
    stats.proposedFiles > 1
      ? `refine.summary.review${one ? "One" : "Many"}Scoped`
      : `refine.summary.review${one ? "One" : "Many"}`;
  return i18n.t(key, {
    round,
    kept: stats.keptHunks,
    total: stats.totalHunks,
    changedFiles: stats.changedFiles,
    proposedFiles: stats.proposedFiles,
    additions: stats.additions,
    removals: stats.removals,
  });
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
  // Same geometry as the file editor's toolbar, down to the padding: this tab
  // opens beside the editor in a split, and a bar that is a few pixels off
  // reads as a mistake in the split, not as a different panel.
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
  spacer: {
    flex: 1,
  },
  fileName: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 0,
  },
  fileDir: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 1,
  },
  // Shrinks before the file name does — the document being refined is what
  // identifies the tab, so it is the last thing that should be truncated.
  impactText: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
    flexShrink: 2,
  },
  // A full-width strip rather than a line squeezed into the toolbar: a failed
  // round is the one message here that has to survive being read at a glance.
  errorBanner: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  errorBannerText: {
    color: theme.colors.destructive,
    fontSize: compactFont(theme.fontSize.sm),
  },
  workingSet: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  stripLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  // The references tab's chip metrics, so a chip means the same thing and is
  // the same size wherever these job tabs put one.
  chip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    maxWidth: 280,
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
    fontWeight: theme.fontWeight.semibold,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.xs),
  },
  instructionBar: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  presetNote: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontStyle: "italic",
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
  instructionField: {
    flex: 1,
    minWidth: 0,
  },
  instructionInput: {
    minHeight: 56,
    maxHeight: 140,
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
  fileTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  keptCount: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  hunk: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  hunkHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    // Indented past the file heading's chevron, so the nesting is legible
    // without a second chevron column.
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    ...(isWeb ? ({ cursor: "pointer" } as object) : {}),
  },
  hunkName: {
    color: theme.colors.foreground,
    fontSize: compactFont(theme.fontSize.sm),
    fontWeight: theme.fontWeight.semibold,
  },
  hunkStat: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.xs),
    fontVariant: ["tabular-nums"],
  },
  decisionKept: {
    color: theme.colors.statusSuccess,
    fontSize: compactFont(theme.fontSize.sm),
  },
  decisionDropped: {
    color: theme.colors.foregroundMuted,
    fontSize: compactFont(theme.fontSize.sm),
  },
  hunkBody: {
    backgroundColor: theme.colors.background,
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
