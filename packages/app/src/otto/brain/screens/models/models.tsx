import { useStyles } from "./styles";
import { useBrainOperations } from "../context";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { BrainHostStatus } from "../contracts/host";
/**
 * The Models tab: the TUI's standard view, as a table plus a detail panel.
 *
 * The list is a TABLE, not a stack of cards: these rows are compared against
 * each other (score, quant, size, what fits) and a card layout makes that
 * comparison impossible. The pinned header imports the same column widths as the
 * rows, because a header that is just another row of the scrolling list scrolls
 * away with it.
 *
 * Ordering matches the TUI: benchmarked models first by score, then the rest by
 * name. A model you have measured is more useful than one you have not, and
 * alphabetical order buries it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { withBrainTheme } from "../theme";
import type { BrainInventoryModel, BrainJob } from "../contracts/models";
import { Eye, Neurology, Pencil, Play, RotateCw, Square, Trash2, Undo2, X, Zap } from "../ui/icons";
import { Alert } from "@/components/ui/alert";
import { BrainModelFamilyIcon } from "../ui/model-family-icon";
import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner } from "../theme";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "../ui/scrollbar";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useBrainJobs } from "../data";

import type { BrainScreenTheme as Theme } from "../theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useBrainLayoutStore } from "../layout-store";
import { BrainSplitter } from "../ui/splitter";
import { BrainProfileEditor } from "./profile-editor";
import { formatQuantLabel } from "./quant-label";
import { uniqueBrainInventoryModels } from "../library/model-filter";
import { brainModelLifecycleState } from "./lifecycle";
import { useBrainInventory, useBrainStatus } from "../data";
import { formatGiB, formatScore, scoreBand } from "../format";

const ThemedPlay = withBrainTheme(Play);
const ThemedSquare = withBrainTheme(Square);
const ThemedRotateCw = withBrainTheme(RotateCw);
const ThemedTrash = withBrainTheme(Trash2);
const ThemedX = withBrainTheme(X);
const ThemedEye = withBrainTheme(Eye);
const ThemedZap = withBrainTheme(Zap);
const ThemedNeurologyCap = withBrainTheme(Neurology);
const ThemedBrainModelFamilyIcon = withBrainTheme(BrainModelFamilyIcon);
const ThemedSpinner = BrainLoadingSpinner;

const mutedModelFamilyIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const servingModelFamilyIconMapping = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
});

const smallIcon = (theme: Theme) => ({ color: theme.colors.foreground, size: theme.iconSize.sm });
const dangerIcon = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
  size: theme.iconSize.sm,
});

const ThemedPencil = withBrainTheme(Pencil);
const ThemedUndo = withBrainTheme(Undo2);

const loadIcon = <ThemedPlay uniProps={smallIcon} />;
const unloadIcon = <ThemedSquare uniProps={smallIcon} />;
const reloadIcon = <ThemedRotateCw uniProps={smallIcon} />;
const deleteIcon = <ThemedTrash uniProps={dangerIcon} />;
const cancelIcon = <ThemedX uniProps={smallIcon} />;
const renameIcon = <ThemedPencil uniProps={smallIcon} />;
const resetNameIcon = <ThemedUndo uniProps={smallIcon} />;

// Mirrors host-api.ts's MAX_DISPLAY_NAME and its ASCII-only check, so a
// rejection shows in the modal instead of costing a round trip.
const MAX_DISPLAY_NAME = 200;
function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > MAX_DISPLAY_NAME) {
    return `Must be at most ${MAX_DISPLAY_NAME} characters`;
  }
  if (/[^\x20-\x7E]/.test(trimmed)) {
    return "Must not contain control characters or non-ASCII";
  }
  return null;
}

// Capability icon colors match the TUI's own ANSI palette exactly (`app.ts`
// scoreColour()/capability badges: V cyan, M magenta, R green) so a model that
// reads a certain way in the terminal reads the same way here.
const visionIconMapping = (theme: Theme) => ({
  color: theme.colors.terminal.cyan,
  size: theme.iconSize.xs,
});
const multiTokenIconMapping = (theme: Theme) => ({
  color: theme.colors.terminal.magenta,
  size: theme.iconSize.xs,
});
const reasoningIconMapping = (theme: Theme) => ({
  color: theme.colors.terminal.green,
  size: theme.iconSize.xs,
});
const MODEL_FAMILY_ICON_SIZE = 16;

// Shared between the pinned header and every row. One source, or they drift.
// The four right-hand columns are pinned to an exact pixel width
// (`flexShrink: 0`) so header and row cells always land at the same x
// regardless of available width - only `name` (the one flexible column) gives
// ground when the panel is narrow. Without `flexShrink: 0` here, the header
// (outside the scroll region) and the rows (inside it, competing with the
// scrollbar's gutter) shrink by different amounts and drift out of alignment.
//
// Each width is the widest content that column must hold, and no wider. The
// cells are right-aligned, so any slack inside a box lands on its *left* and
// reads as extra space in the gap before it - an over-wide box makes the
// row's gaps look uneven even though every gap is the same 10px. Sized at
// `fontSize.code` (12px) mono, ~7.2px per character:
//   score  "Score"     5 chars, plus a little breathing room at compact scale
//   quant  "IQ2_XXS"   7 chars
//   size   "104.3 GB"  8 chars - three-digit GB has to fit unclipped
//   tags   three 12px icons at a 4px gap

/**
 * Benchmarked models first by score, then unbenchmarked by name. Mirrors the
 * TUI's ordering so a library that read one way in the terminal reads the same
 * here (the TUI also adds small capability bonuses; the score is the part that
 * actually moves the order).
 */
function sortModels(models: BrainInventoryModel[]): BrainInventoryModel[] {
  return [...models].sort((a, b) => {
    const aScore = a.score?.overall ?? null;
    const bScore = b.score?.overall ?? null;
    if (aScore !== null && bScore !== null) {
      return bScore - aScore;
    }
    if (aScore !== null) {
      return -1;
    }
    if (bScore !== null) {
      return 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

function queuedModelIds(status: BrainHostStatus | undefined): Record<string, number> {
  return status?.waitingModelIds ?? {};
}

function hasActiveInference(
  model: BrainInventoryModel,
  status: BrainHostStatus | undefined,
): boolean {
  return (
    status?.slots?.threads.some((row) => row.modelId === model.id && row.phase !== "idle") ?? false
  );
}

function displayModelState(
  model: BrainInventoryModel,
  status: BrainHostStatus | undefined,
  job: BrainJob | undefined,
  waitingModelIds: Record<string, number>,
): BrainInventoryModel["state"] {
  const lifecycle = brainModelLifecycleState(model, status);
  if (job?.queuePosition) return "queued";
  if (job?.status === "running") {
    return lifecycle === "loading" || lifecycle === "unloading" ? lifecycle : "active";
  }
  const waiting = waitingModelIds[model.id];
  if (typeof waiting === "number" && waiting > 0) return "queued";
  if (hasActiveInference(model, status)) return "active";
  return lifecycle ?? model.state;
}

function ScoreText({ overall }: { overall: number | null | undefined }) {
  const styles = useStyles();
  const band = scoreBand(overall);
  const style = useMemo(
    () => [
      styles.cellScore,
      band === "good" && styles.scoreGood,
      band === "fair" && styles.scoreFair,
      band === "poor" && styles.scorePoor,
      band === "bad" && styles.scoreBad,
    ],
    [styles, band],
  );
  return <Text style={style}>{formatScore(overall)}</Text>;
}

/** An icon that reveals its meaning on hover/focus instead of a printed legend. */
function CapabilityIcon({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <View accessibilityLabel={label}>{children}</View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function CapabilityIcons({ model }: { model: BrainInventoryModel }) {
  const styles = useStyles();
  return (
    <View style={styles.capsRow}>
      {model.hasProjector ? (
        <CapabilityIcon label="Vision">
          <ThemedEye uniProps={visionIconMapping} />
        </CapabilityIcon>
      ) : null}
      {model.mtp ? (
        <CapabilityIcon label="Multi-token prediction">
          <ThemedZap uniProps={multiTokenIconMapping} />
        </CapabilityIcon>
      ) : null}
      {model.reasoning ? (
        <CapabilityIcon label="Reasoning">
          <ThemedNeurologyCap uniProps={reasoningIconMapping} />
        </CapabilityIcon>
      ) : null}
    </View>
  );
}

/**
 * The family mark is state, not decoration: resident models use the serving
 * color, and every in-flight operation replaces that mark with a same-sized
 * spinner. This keeps the status line underneath plain text.
 */
function ModelFamilyStateIcon({
  family,
  state,
  busy,
}: {
  family: string | null | undefined;
  state: BrainInventoryModel["state"];
  busy: boolean;
}) {
  if (busy) return <ThemedSpinner size={MODEL_FAMILY_ICON_SIZE} />;

  return (
    <ThemedBrainModelFamilyIcon
      family={family}
      size={MODEL_FAMILY_ICON_SIZE}
      uniProps={
        state === "loaded" || state === "active"
          ? servingModelFamilyIconMapping
          : mutedModelFamilyIconMapping
      }
    />
  );
}

/** A compact action whose visible label lives in its desktop tooltip. */
function ModelIconAction({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: {
  label: string;
  icon: ReactElement;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID: string;
}) {
  const styles = useStyles();
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={icon}
          onPress={onPress}
          disabled={disabled}
          loading={loading}
          accessibilityLabel={label}
          testID={testID}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ModelDetailHeader({
  model,
  canWrite,
  pending,
  onOpenRename,
  onResetName,
}: {
  model: BrainInventoryModel;
  canWrite: boolean;
  pending: ModelAction | null;
  onOpenRename: () => void;
  onResetName: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.detailHeader}>
      <View style={styles.detailTitleRow}>
        <ThemedBrainModelFamilyIcon
          family={model.family}
          size={20}
          uniProps={mutedModelFamilyIconMapping}
        />
        <Text style={styles.detailTitle} numberOfLines={2}>
          {model.displayName}
        </Text>
        <View style={styles.nameActions}>
          <ModelIconAction
            label="Rename"
            icon={renameIcon}
            onPress={onOpenRename}
            disabled={!canWrite || pending !== null}
            testID="brain-model-rename"
          />
          <ModelIconAction
            label="Reset name"
            icon={resetNameIcon}
            onPress={onResetName}
            loading={pending === "reset-name"}
            disabled={!canWrite || pending !== null}
            testID="brain-model-reset-name"
          />
        </View>
      </View>
      {model.state === "loaded" ? <StatusBadge label="Loaded" variant="success" /> : null}
      {model.state === "loading" ? <StatusBadge label="Loading" variant="warning" /> : null}
      {model.state === "unloading" ? <StatusBadge label="Unloading" variant="warning" /> : null}
      {model.state === "active" ? <StatusBadge label="Active" variant="success" /> : null}
      {model.state === "queued" ? <StatusBadge label="Queued" variant="warning" /> : null}
    </View>
  );
}

/** The present-tense label for the job kinds a model row can show live. */
function tuningJobLabel(kind: BrainJob["kind"]): string {
  if (kind === "calibrate") return "Calibrating";
  if (kind === "bench") return "Benchmarking";
  return "Sweeping";
}

interface VisibleColumns {
  quant: boolean;
  size: boolean;
  tags: boolean;
}

function ModelRow({
  model,
  selected,
  onSelect,
  job,
  columns,
  compactCaps,
}: {
  model: BrainInventoryModel;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The most recent calibrate/sweep/benchmark job for this model, if any. */
  job: BrainJob | undefined;
  columns: VisibleColumns;
  /** Compact themes double capability icon size for touch readability. */
  compactCaps: boolean;
}) {
  const styles = useStyles();
  const handlePress = useCallback(() => onSelect(model.id), [model.id, onSelect]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
    ],
    [styles, selected],
  );
  const jobRunning = job?.status === "running";
  // One spinner per row, carried by the state marker: a transitioning
  // lifecycle and a running job are both just "this row is working".
  const busy =
    jobRunning ||
    model.state === "loading" ||
    model.state === "unloading" ||
    model.state === "queued";

  return (
    <PressHighlight
      style={rowStyle}
      onPress={handlePress}
      testID={`brain-model-${model.id}`}
      accessibilityRole="button"
      accessibilityLabel={model.displayName}
    >
      <View style={styles.cellName}>
        <View style={styles.nameRow}>
          <ModelFamilyStateIcon family={model.family} state={model.state} busy={busy} />
          <Text style={styles.nameText} numberOfLines={1}>
            {model.displayName}
          </Text>
        </View>
        {jobRunning ? (
          <Text style={styles.rowJobStatusText} numberOfLines={1}>
            {tuningJobLabel(job.kind)}
            {job.message ? ` — ${job.message}` : "…"}
          </Text>
        ) : null}
      </View>
      <ScoreText overall={model.score?.overall} />
      {columns.quant ? (
        <Text style={styles.cellQuant} numberOfLines={1}>
          {formatQuantLabel(model.quant)}
        </Text>
      ) : null}
      {columns.size ? (
        <Text style={styles.cellSize} numberOfLines={1}>
          {formatGiB(model.sizeBytes)}
        </Text>
      ) : null}
      {columns.tags ? (
        <View style={[styles.cellTags, compactCaps && styles.capsColumnCompact]}>
          <CapabilityIcons model={model} />
        </View>
      ) : null}
    </PressHighlight>
  );
}

// Narrower than this and a column no longer has room to earn its keep -
// dropped in priority order (least useful first): Quant, then Size, then
// Caps. Name and Score always show; Name is the one flexible column, so it
// simply reclaims whatever width the dropped columns free up.
const QUANT_HIDE_BELOW = 440;
const SIZE_HIDE_BELOW = 370;
const TAGS_HIDE_BELOW = 290;

function ModelsTable({
  models,
  selectedId,
  onSelect,
  jobByModelId,
}: {
  models: BrainInventoryModel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  jobByModelId: Map<string, BrainJob>;
}) {
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  const tableScrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(tableScrollRef);
  const [tableWidth, setTableWidth] = useState(0);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setTableWidth(width);
  }, []);
  // Unmeasured (first paint) shows every column rather than flashing a
  // narrow layout first.
  const columns: VisibleColumns = useMemo(
    () => ({
      quant: tableWidth === 0 || tableWidth >= QUANT_HIDE_BELOW,
      size: tableWidth === 0 || tableWidth >= SIZE_HIDE_BELOW,
      tags: tableWidth === 0 || tableWidth >= TAGS_HIDE_BELOW,
    }),
    [tableWidth],
  );

  return (
    <View style={styles.table} testID="brain-models-table" onLayout={handleLayout}>
      {/* Pinned header, outside the scroll region below it. */}
      <View style={styles.headerRow}>
        <Text style={styles.headerName}>Model</Text>
        <Text style={styles.headerScore}>Score</Text>
        {columns.quant ? <Text style={styles.headerQuant}>Quant</Text> : null}
        {columns.size ? <Text style={styles.headerSize}>Size</Text> : null}
        {columns.tags ? (
          <Text style={[styles.headerTags, isCompact && styles.capsColumnCompact]}>Caps</Text>
        ) : null}
      </View>
      <View style={styles.tableScrollRegion}>
        <ScrollView
          ref={tableScrollRef}
          style={styles.tableScroll}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={isNative}
        >
          {models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={model.id === selectedId}
              onSelect={onSelect}
              job={jobByModelId.get(model.id)}
              columns={columns}
              compactCaps={isCompact}
            />
          ))}
        </ScrollView>
        {scrollbar.overlay}
      </View>
    </View>
  );
}

function MetadataLine({ model }: { model: BrainInventoryModel }) {
  const styles = useStyles();
  const parts: string[] = [];
  if (model.arch) {
    parts.push(model.arch);
  }
  if (model.blockCount) {
    parts.push(`${model.blockCount} layers`);
  }
  if (model.headCountKv) {
    parts.push(`${model.headCountKv} KV heads`);
  }
  if (model.contextLength) {
    parts.push(`${model.contextLength.toLocaleString()} native context`);
  }
  if (parts.length === 0) {
    return null;
  }
  return <Text style={styles.metadata}>{parts.join(" · ")}</Text>;
}

type ModelAction = "load" | "unload" | "delete" | "reset-name";

/**
 * Load, Unload, or Reload, depending on whether the model is resident and
 * whether an unapplied edit is sitting on it. Reload reuses the Load call: the
 * brain's `/model/load` restarts the child even when it is already serving
 * the requested model, so re-issuing it is how a `requiresRestart` edit gets
 * applied - there is no separate reload endpoint to call.
 */
const RESIDENT_MODEL_STATES = new Set(["loaded", "loading", "unloading", "active"]);

function LoadUnloadButton({
  model,
  requiresRestart,
  canWrite,
  pending,
  onLoad,
  onUnload,
}: {
  model: BrainInventoryModel;
  requiresRestart: boolean;
  canWrite: boolean;
  pending: ModelAction | null;
  onLoad: () => void;
  onUnload: () => void;
}) {
  const isLoaded = RESIDENT_MODEL_STATES.has(model.state);
  const disabled = !canWrite || pending !== null || model.state === "queued";

  if (isLoaded && requiresRestart) {
    return (
      <Button
        variant="secondary"
        size="sm"
        leftIcon={reloadIcon}
        onPress={onLoad}
        loading={pending === "load"}
        disabled={disabled}
        testID="brain-model-reload"
      >
        Reload
      </Button>
    );
  }

  if (isLoaded) {
    return (
      <Button
        variant="secondary"
        size="sm"
        leftIcon={unloadIcon}
        onPress={onUnload}
        loading={pending === "unload"}
        disabled={disabled}
        testID="brain-model-unload"
      >
        Unload
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={loadIcon}
      onPress={onLoad}
      loading={pending === "load"}
      disabled={disabled}
      testID="brain-model-load"
    >
      Load
    </Button>
  );
}

function useCalibrationCompletion(
  job: BrainJob | undefined,
  onCalibrated: () => void,
  onChanged: () => void,
): void {
  useEffect(() => {
    if (job?.kind === "calibrate" && job.status === "succeeded") {
      onCalibrated();
      onChanged();
    }
  }, [job?.id, job?.kind, job?.status, onCalibrated, onChanged]);
}

function ModelActions({
  model,
  canWrite,
  canRunJobs,
  job,
  tuningBusy,
  requiresRestart,
  calibrationRequired,
  onChanged,
  onReloaded,
  onCalibrated,
  onJobStarted,
}: {
  serverId: string;
  model: BrainInventoryModel;
  canWrite: boolean;
  /** The host owns calibration and sweep jobs for its local model store. */
  canRunJobs: boolean;
  /** The most recent calibrate/sweep/benchmark job for this model, if any. */
  job: BrainJob | undefined;
  /** Whether any tuning job is running tab-wide - the brain runs one at a time. */
  tuningBusy: boolean;
  /** True once an edit has been saved onto the loaded model without applying it. */
  requiresRestart: boolean;
  /** The saved tuning profile changed after its last VRAM calibration. */
  calibrationRequired: boolean;
  onChanged: () => void;
  /** Clears `requiresRestart` once the load call that applies it has landed. */
  onReloaded: () => void;
  onCalibrated: () => void;
  onJobStarted: (job: BrainJob) => void;
}) {
  const styles = useStyles();
  const client = useBrainOperations();
  const [pending, setPending] = useState<ModelAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const isLoaded = RESIDENT_MODEL_STATES.has(model.state);
  const jobRunning = job?.status === "running";

  useCalibrationCompletion(job, onCalibrated, onChanged);

  const run = useCallback(
    async (action: ModelAction, call: () => Promise<unknown>, onSuccess?: () => void) => {
      setPending(action);
      setError(null);
      try {
        await call();
        onChanged();
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [onChanged],
  );

  // Calibrate and sweep are long jobs that keep running on the brain no matter
  // what this component does next - the returned job goes straight into the
  // shared job list (rendered below, and in the table row for this model) so
  // navigating away and back still shows live progress instead of losing it.
  const handleCalibrate = useCallback(() => {
    if (!client) return;
    setError(null);
    void client
      .calibrate(model.id)
      .then(onJobStarted)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [client, model.id, onJobStarted]);

  const handleSweep = useCallback(() => {
    if (!client) return;
    setError(null);
    void client
      .sweep(model.id)
      .then(onJobStarted)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [client, model.id, onJobStarted]);

  const handleCancelJob = useCallback(() => {
    if (!client || !job) return;
    void client
      .cancelJob(job.id)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [client, job]);

  // Load doubles as Reload: the brain's /model/load restarts the child even
  // when the requested model is already the resident one (`Supervisor.start`
  // always stops first), so re-issuing it is exactly how an edited profile
  // that `requiresRestart` gets applied.
  const handleLoad = useCallback(() => {
    if (client) {
      // The brain's load endpoint answers only once the load has finished, so
      // the shared cache is nudged first; the next authoritative snapshot from
      // the brain replaces it either way.
      client.previewLifecycle({ modelId: model.id, lifecycle: "loading" });
      void run("load", () => client.loadModel(model.id), onReloaded);
    }
  }, [client, model.id, run, onReloaded]);

  const handleUnload = useCallback(() => {
    if (client) {
      client.previewLifecycle({ modelId: model.id, lifecycle: "unloading" });
      void run("unload", () => client.unloadModel(model.id));
    }
  }, [client, model.id, run]);

  const handleDelete = useCallback(() => {
    void (async () => {
      if (!client) {
        return;
      }
      // Deleting model files is irreversible and frees tens of gigabytes, so it
      // confirms. The brain refuses outright while the model is loaded.
      const confirmed = await confirmDialog({
        title: `Delete ${model.displayName}?`,
        message: `This removes the model files from disk, freeing about ${formatGiB(
          model.sizeBytes + model.mmprojBytes,
        )}. It cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (confirmed) {
        await run("delete", () => client.deleteModel(model.id));
      }
    })();
  }, [client, model.displayName, model.id, model.mmprojBytes, model.sizeBytes, run]);

  const handleOpenRename = useCallback(() => setRenameOpen(true), []);
  const handleCloseRename = useCallback(() => setRenameOpen(false), []);
  const handleRenameSubmit = useCallback(
    async (value: string) => {
      if (!client) return;
      await client.renameModel(model.id, value.trim());
      onChanged();
    },
    [client, model.id, onChanged],
  );

  const handleResetName = useCallback(() => {
    if (client) {
      void run("reset-name", () => client.resetModelName(model.id));
    }
  }, [client, model.id, run]);

  return (
    <View style={styles.actionsColumn}>
      <ModelDetailHeader
        model={model}
        canWrite={canWrite}
        pending={pending}
        onOpenRename={handleOpenRename}
        onResetName={handleResetName}
      />
      <MetadataLine model={model} />
      <View style={styles.actionsRow}>
        <LoadUnloadButton
          model={model}
          requiresRestart={requiresRestart}
          canWrite={canWrite}
          pending={pending}
          onLoad={handleLoad}
          onUnload={handleUnload}
        />
        {canRunJobs ? (
          <>
            {/* Measure real KV bytes/token. The theoretical formula overestimates
                badly on architectures that keep a full cache on only some layers,
                so this usually UNLOCKS context rather than taking it away. */}
            <Button
              variant="secondary"
              size="sm"
              onPress={handleCalibrate}
              disabled={tuningBusy}
              testID="brain-model-calibrate"
            >
              Calibrate
            </Button>
            {/* Find the reasoning budget that returns content instead of
                endless thinking. */}
            <Button
              variant="secondary"
              size="sm"
              onPress={handleSweep}
              disabled={tuningBusy}
              testID="brain-model-sweep"
            >
              Sweep
            </Button>
          </>
        ) : null}
        <ModelIconAction
          label="Delete"
          icon={deleteIcon}
          onPress={handleDelete}
          loading={pending === "delete"}
          disabled={!canWrite || pending !== null || isLoaded}
          testID="brain-model-delete"
        />
      </View>
      {calibrationRequired ? (
        <Alert
          variant="warning"
          title="Calibration needed"
          description="This model's last VRAM measurement is stale. Calibrate to refresh the budget."
        />
      ) : null}
      <AdaptiveRenameModal
        visible={renameOpen}
        title="Rename model"
        initialValue={model.displayName}
        placeholder="Display name"
        submitLabel="Rename"
        maxLength={MAX_DISPLAY_NAME}
        validate={validateDisplayName}
        onClose={handleCloseRename}
        onSubmit={handleRenameSubmit}
        testID="brain-model-rename-modal"
      />
      {job && (jobRunning || job.status === "failed") ? (
        <View style={styles.jobStatus} testID="brain-model-job-status">
          {jobRunning ? <ThemedSpinner size="small" /> : null}
          <View style={styles.jobStatusText}>
            <Text
              style={job.status === "failed" ? styles.jobStatusFailed : styles.jobStatusRunning}
            >
              {tuningJobLabel(job.kind)}
              {job.percent !== null ? ` ${job.percent}%` : ""}
            </Text>
            {(job.error ?? job.message) ? (
              <Text style={styles.jobStatusDetail} numberOfLines={2}>
                {job.error ?? job.message}
              </Text>
            ) : null}
          </View>
          {jobRunning ? (
            <Button variant="ghost" size="sm" leftIcon={cancelIcon} onPress={handleCancelJob}>
              Cancel
            </Button>
          ) : null}
        </View>
      ) : null}
      {error ? <Alert variant="error" description={error} /> : null}
    </View>
  );
}

function ModelDetail({
  serverId,
  model,
  canWrite,
  canRunJobs,
  job,
  tuningBusy,
  onChanged,
  onJobStarted,
}: {
  serverId: string;
  model: BrainInventoryModel;
  canWrite: boolean;
  canRunJobs: boolean;
  job: BrainJob | undefined;
  tuningBusy: boolean;
  onChanged: () => void;
  onJobStarted: (job: BrainJob) => void;
}) {
  const styles = useStyles();
  // Brain persists an unapplied resident-model edit. The editor restores that
  // verdict whenever this detail view is reopened, while a successful reload
  // clears it at the source.
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [calibrationRequired, setCalibrationRequired] = useState(
    () => model.profile?.calibrationRequired ?? true,
  );
  const handleReloaded = useCallback(() => setRequiresRestart(false), []);
  // A calibration rewrites the saved profile from outside the editor, so the
  // editor has to re-read it. Otherwise its budget panel keeps showing the
  // estimate it loaded with and the measurement looks like it was never saved.
  const [profileReloadToken, setProfileReloadToken] = useState(0);
  const handleCalibrated = useCallback(() => {
    setCalibrationRequired(false);
    setProfileReloadToken((token) => token + 1);
  }, []);

  return (
    <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent}>
      <ModelActions
        serverId={serverId}
        model={model}
        canWrite={canWrite}
        canRunJobs={canRunJobs}
        job={job}
        tuningBusy={tuningBusy}
        requiresRestart={requiresRestart}
        calibrationRequired={calibrationRequired}
        onChanged={onChanged}
        onReloaded={handleReloaded}
        onCalibrated={handleCalibrated}
        onJobStarted={onJobStarted}
      />
      <BrainProfileEditor
        // Remount on model change so no draft leaks across a selection.
        key={model.id}
        serverId={serverId}
        modelId={model.id}
        family={model.family}
        components={model.components}
        canWrite={canWrite}
        reloadToken={profileReloadToken}
        onSaved={onChanged}
        onRequiresRestartChange={setRequiresRestart}
        onCalibrationRequiredChange={setCalibrationRequired}
      />
    </ScrollView>
  );
}

export function BrainModelsTab({
  serverId,
  isConnected,
  canWrite,
  canRunJobs,
}: {
  serverId: string;
  isConnected: boolean;
  /** False when the brain has not opted into remote configuration. */
  canWrite: boolean;
  /** The selected Brain host must advertise calibration and sweep jobs. */
  canRunJobs: boolean;
}) {
  const styles = useStyles();
  const modelsSplitRatio = useBrainLayoutStore((state) => state.modelsSplitRatio);
  const setModelsSplitRatio = useBrainLayoutStore((state) => state.setModelsSplitRatio);
  const isCompact = useIsCompactFormFactor();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useBrainInventory(isConnected);
  const statusQuery = useBrainStatus({ enabled: isConnected });

  // Calibrate/sweep/benchmark progress comes from the parent-owned job resource, so
  // progress survives navigating away and back (the job itself keeps running on
  // the brain regardless of which component is mounted; this just re-syncs with
  // it) and shows up both in the table row and the detail pane that started it.
  const jobsEnabled = isConnected && canRunJobs;
  const jobsQuery = useBrainJobs(jobsEnabled);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);

  const jobByModelId = useMemo(() => {
    const map = new Map<string, BrainJob>();
    for (const job of jobs) {
      if (
        (job.kind !== "calibrate" && job.kind !== "sweep" && job.kind !== "bench") ||
        !job.modelId
      ) {
        continue;
      }
      const existing = map.get(job.modelId);
      // Prefer a running job over a lingering finished one; among jobs with the
      // same status, the one that started most recently wins.
      if (
        !existing ||
        (job.status === "running" && existing.status !== "running") ||
        (job.status === existing.status && job.startedAt > existing.startedAt)
      ) {
        map.set(job.modelId, job);
      }
    }
    return map;
  }, [jobs]);
  // The brain runs one job at a time, so a tuning job in flight for ANY model
  // blocks starting another one from any row.
  const tuningBusy = jobs.some((job) => job.status === "running");

  const handleJobStarted = useBrainOperations().observeJob;

  const models = useMemo(() => {
    const status = statusQuery.data;
    const waitingModelIds = queuedModelIds(status);
    return sortModels(
      uniqueBrainInventoryModels(query.data?.models ?? []).map((model) => {
        const operation = jobByModelId.get(model.id);
        const state = displayModelState(model, status, operation, waitingModelIds);
        return state === model.state ? model : Object.assign({}, model, { state });
      }),
    );
  }, [jobByModelId, query.data, statusQuery.data]);
  const disk = query.data?.disk ?? null;

  const selected = useMemo(
    () => models.find((model) => model.id === selectedId) ?? null,
    [models, selectedId],
  );

  const operations = useBrainOperations();
  const handleChanged = useCallback(() => {
    void operations.refresh(["inventory", "status"]);
  }, [operations]);

  const handleBack = useCallback(() => setSelectedId(null), []);

  if (query.isLoading && models.length === 0) {
    return (
      <View style={styles.centered}>
        <ThemedSpinner size="large" />
      </View>
    );
  }

  if (query.error) {
    return (
      <View style={styles.alertInset}>
        <Alert
          variant="error"
          title="Could not read the model library"
          description={query.error instanceof Error ? query.error.message : String(query.error)}
        />
      </View>
    );
  }

  if (models.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>No models installed</Text>
        <Text style={styles.emptyHint}>Download one from the Library tab.</Text>
      </View>
    );
  }

  // Compact has no room for list and detail together, so selecting a row
  // replaces the list, the way every other list-and-detail surface here does.
  if (isCompact) {
    return selected ? (
      <View style={styles.compactDetail}>
        <Button variant="ghost" size="sm" onPress={handleBack} testID="brain-models-back">
          Back to models
        </Button>
        <ModelDetail
          serverId={serverId}
          model={selected}
          canWrite={canWrite}
          canRunJobs={canRunJobs}
          job={jobByModelId.get(selected.id)}
          tuningBusy={tuningBusy}
          onChanged={handleChanged}
          onJobStarted={handleJobStarted}
        />
      </View>
    ) : (
      <View style={styles.compactList}>
        <ModelsTable
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
          jobByModelId={jobByModelId}
        />
        {disk ? (
          <Text style={styles.disk}>
            {`${formatGiB(disk.modelBytes)} models of ${formatGiB(disk.totalBytes)} server storage · ${formatGiB(disk.freeBytes)} free`}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <BrainSplitter
      direction="horizontal"
      ratio={modelsSplitRatio}
      onRatioChange={setModelsSplitRatio}
      testID="brain-models-splitter"
    >
      <View style={styles.listPane}>
        <ModelsTable
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
          jobByModelId={jobByModelId}
        />
        {disk ? (
          <Text style={styles.disk}>
            {`${formatGiB(disk.modelBytes)} models of ${formatGiB(disk.totalBytes)} server storage · ${formatGiB(disk.freeBytes)} free`}
          </Text>
        ) : null}
      </View>
      <View style={styles.detailPane}>
        {selected ? (
          <ModelDetail
            serverId={serverId}
            model={selected}
            canWrite={canWrite}
            canRunJobs={canRunJobs}
            job={jobByModelId.get(selected.id)}
            tuningBusy={tuningBusy}
            onChanged={handleChanged}
            onJobStarted={handleJobStarted}
          />
        ) : (
          <View style={styles.centered}>
            <Text style={styles.empty}>Select a model</Text>
          </View>
        )}
      </View>
    </BrainSplitter>
  );
}
