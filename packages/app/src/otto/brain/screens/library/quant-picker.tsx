import { useStyles } from "./styles";
import { useBrainSurfaceActive } from "../../lifecycle";

import { useBrainModelRevision } from "../data";
import { useBrainOperations } from "../context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import type { BrainJob, BrainRepoQuant } from "../contracts/models";

import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner as LoadingSpinner } from "../theme";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "../ui/select-field";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { settingsStyles } from "@/styles/settings";
import type { BrainScreenTheme as Theme } from "../theme";
import { confirmDialog } from "@/utils/confirm-dialog";

import { activeBrainQuantJob, selectInitialBrainQuant } from "./quant-selection";

import {
  bundleOptionsIcon,
  useReportBrainError,
  formatBytes,
  ThemedDownloadProgressRing,
  useDownloadSubmission,
} from "./common";

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export const searchPlaceholderProps = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

/**
 * A "Quants" button that turns into a combo box once its list has loaded, so
 * picking a quantization is one dropdown plus a Download press instead of a
 * long unrolled list of rows. Self-contained: owns its own fetch, so
 * `CatalogRow`/`SearchResultRow` just hand it a repo and a download callback.
 */
type QuantAction = "cancel" | "delete" | "download" | "installed";

export interface PinnedHuggingFaceModel {
  id: string;
  name: string;
  repo: string | null;
  quant: string | null;
  /** Primary GGUF size from the installed-model inventory. */
  sizeBytes: number;
  /** Whether the installed model includes its vision-projector companion. */
  hasProjector: boolean;
}

function getQuantAction({
  running,
  installed,
  deletable,
}: {
  running: boolean;
  installed: boolean;
  deletable: boolean;
}): QuantAction {
  if (running) return "cancel";
  if (!installed) return "download";
  return deletable ? "delete" : "installed";
}

function markQuantRemoved(quants: BrainRepoQuant[], quantName: string): BrainRepoQuant[] {
  return quants.map((quant) =>
    quant.quant === quantName ? { ...quant, installed: false, modelId: null } : quant,
  );
}

/** A local event in the app cache, so every open quant picker reloads after a model mutation. */

interface QuantPickerProps {
  serverId: string;
  repo: string;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (
    repo: string,
    quant: string,
    components?: string[],
    expectedBytes?: number,
  ) => Promise<void>;
  /** Bundles keep this quant picker but attach the checked companion files. */
  onBundleDownload?: (quant: string, quantBytes: number) => Promise<void>;
  onCancel: (jobId: string) => void;
  initialQuant?: string | null;
  /** The inventory id for a pinned installed quant. */
  initialModelId?: string | null;
  /** Bundle pulls use their catalog id rather than repo#quant as the job target. */
  jobTarget?: string | null;
  /** Keep a bundle option sheet bound to the quant selected on this row. */
  onQuantChange?: (quant: string, sizeBytes: number) => void;
  /** Bundle rows use a compact progress ring alongside their action button. */
  showProgressRing?: boolean;
  /** Discovery owns the projector sheet. Catalog rows already render their own bundle control. */
  showDetectedBundleOptions?: boolean;
  /** Inventory already proved this installed repo has a projector, before its quant list is loaded. */
  knownBundle?: boolean;
}

export function QuantPicker(props: QuantPickerProps) {
  const view = useQuantPicker(props);
  return <QuantPickerView view={view} />;
}

function useQuantPicker({
  repo,
  busy,
  jobs,
  onDownload,
  onBundleDownload,
  onCancel,
  initialQuant = null,
  initialModelId = null,
  jobTarget = null,
  onQuantChange,
  showProgressRing = true,
  showDetectedBundleOptions = true,
  knownBundle = false,
}: QuantPickerProps) {
  const styles = useStyles();
  const reportError = useReportBrainError();
  const { pending, submit } = useDownloadSubmission();
  const client = useBrainOperations();
  const surfaceActive = useBrainSurfaceActive();
  const modelRevision = useBrainModelRevision();
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  // Discovery has no catalog component state to update optimistically. Keep
  // its switch truthful from the instant the download starts, then reconcile
  // it with inventory once the tracked job settles.
  const [projectorPending, setProjectorPending] = useState(false);
  const [quants, setQuants] = useState<BrainRepoQuant[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const observedRevision = useRef(modelRevision);

  // Before selection, recover a repository pull after remount. Once a quant
  // is selected, it alone owns this row's progress and cancel control: sibling
  // quant pulls are allowed to run at the same time.
  const activeJob = useMemo(
    () => activeBrainQuantJob(jobs, repo, selected, jobTarget),
    [jobTarget, jobs, repo, selected],
  );
  const downloadProgressIcon = useMemo(
    () =>
      showProgressRing && activeJob?.status === "running" ? (
        <ThemedDownloadProgressRing job={activeJob} />
      ) : undefined,
    [activeJob, showProgressRing],
  );

  const handleLoad = useCallback(async () => {
    if (!client) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const rows = await client.readQuants(repo);
      if (seq === requestSeq.current) {
        setQuants(rows);
        setLoaded(true);
      }
    } catch (error) {
      reportError("Could not list quantizations", error);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [client, repo, reportError]);
  const handleOpenBundleOptions = useCallback(() => {
    setBundleOpen(true);
    if (!loaded) void handleLoad();
  }, [handleLoad, loaded]);

  // Reopen the picker on its own if this repo already has a pull running -
  // otherwise remounting (tab switch, navigating away and back) leaves the
  // user staring at a disabled button with no way to see their download is
  // still going.
  useEffect(() => {
    if (surfaceActive && activeJob && !loaded) handleLoad();
  }, [surfaceActive, activeJob, loaded, handleLoad]);

  useEffect(() => {
    if (!surfaceActive || !loaded || observedRevision.current === modelRevision) return;
    observedRevision.current = modelRevision;
    void handleLoad();
  }, [surfaceActive, handleLoad, loaded, modelRevision]);

  useEffect(() => {
    if (!surfaceActive || !bundleOpen || pending || activeJob?.status === "running") return;
    setProjectorPending(false);
    void handleLoad();
  }, [surfaceActive, activeJob?.status, bundleOpen, handleLoad, pending]);

  // Once the quant list loads, prefer an installed quant so a reopened picker
  // immediately offers its useful Delete action. A running job still wins: its
  // target is the only quant whose progress/cancel state this row can show.
  useEffect(() => {
    if (!loaded || selected !== null) return;
    const activeQuant = jobTarget ? initialQuant : (activeJob?.quant ?? null);
    const quant = selectInitialBrainQuant(quants, initialQuant, activeJob ? activeQuant : null);
    if (quant) {
      setSelected(quant);
      // Catalog bundle controls keep their own selected primary. Synchronize
      // that state with this automatic installed-quant choice, not just with
      // explicit dropdown clicks, so Options targets what the user sees.
      onQuantChange?.(quant, quants.find((row) => row.quant === quant)?.sizeBytes ?? 0);
    }
  }, [loaded, activeJob, initialQuant, jobTarget, onQuantChange, quants, repo, selected]);

  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      quants.map((q) => ({
        id: q.quant,
        value: q.quant,
        label: q.installed ? `${q.quant} (installed)` : q.quant,
        description: q.size,
      })),
    [quants],
  );
  const selectedOption = useMemo(
    () => options.find((option) => option.value === selected) ?? null,
    [options, selected],
  );
  const selectedQuant = useMemo(
    () => quants.find((q) => q.quant === selected) ?? null,
    [quants, selected],
  );
  const projector = selectedQuant?.projector;
  // The primary quant's action always reflects the primary artifact. Optional
  // bundle components are installed and removed from Bundle options, so an
  // installed quant remains deletable instead of misleadingly saying Download.
  const alreadyInstalled = selectedQuant?.installed ?? false;
  const selectedModelId =
    selectedQuant?.modelId ?? (selected === initialQuant ? initialModelId : null);
  const handleChange = useCallback(
    (value: string) => {
      setSelected(value);
      onQuantChange?.(value, quants.find((row) => row.quant === value)?.sizeBytes ?? 0);
    },
    [onQuantChange, quants],
  );
  const handleDownload = useCallback(() => {
    if (!selected) return;
    void submit(() =>
      onBundleDownload
        ? onBundleDownload(selected, selectedQuant?.sizeBytes ?? 0)
        : onDownload(repo, selected, [], selectedQuant?.sizeBytes ?? 0),
    );
  }, [onBundleDownload, onDownload, repo, selected, selectedQuant?.sizeBytes, submit]);
  const handleDiscoveredProjectorChange = useCallback(
    (enabled: boolean) => {
      if (!selected || !projector) return;
      if (enabled) {
        void submit(async () => {
          setProjectorPending(true);
          try {
            await onDownload(
              repo,
              selected,
              ["vision-projector"],
              (selectedQuant?.sizeBytes ?? 0) + projector.sizeBytes,
            );
          } catch (error) {
            setProjectorPending(false);
            throw error;
          }
        });
        return;
      }
      setProjectorPending(false);
      // A bundle options edit must never stop the selected quant transfer.
      if (activeJob?.status === "running") return;
      if (!client || !selectedModelId) return;
      void client
        .deleteComponent(selectedModelId, "vision-projector")
        .then(handleLoad)
        .catch((error) => reportError("Unable to remove the vision projector", error));
    },
    [
      activeJob,
      client,
      handleLoad,
      onDownload,
      projector,
      repo,
      selected,
      selectedModelId,
      selectedQuant?.sizeBytes,
      reportError,
      submit,
    ],
  );
  const handleCancel = useCallback(() => {
    if (activeJob?.status === "running") onCancel(activeJob.id);
  }, [activeJob, onCancel]);
  const handleDelete = useCallback(() => {
    const modelId = selectedModelId;
    if (!client || !modelId || !selectedQuant) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: `Delete ${repo} ${selectedQuant.quant}?`,
        message: "This removes the downloaded model files from disk. It cannot be undone.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      try {
        setDeleting(true);
        await client.deleteModel(modelId);
        setQuants((previous) => markQuantRemoved(previous, selectedQuant.quant));
        await client.refresh(["catalog", "inventory", "runtimes"]);
      } catch (error) {
        reportError("Unable to delete the model", error);
      } finally {
        setDeleting(false);
      }
    })();
  }, [client, repo, selectedModelId, selectedQuant, reportError]);
  const action = getQuantAction({
    running: activeJob?.status === "running",
    installed: alreadyInstalled,
    deletable: Boolean(selectedModelId),
  });
  const actionHandlers = {
    cancel: handleCancel,
    delete: handleDelete,
    download: handleDownload,
    installed: handleDownload,
  } satisfies Record<QuantAction, () => void>;
  const selectedDisplay = useMemo(
    () =>
      selectedOption
        ? { label: selectedOption.label, description: selectedOption.description }
        : null,
    [selectedOption],
  );
  const bundleHeader = useMemo(() => ({ title: `Bundle options for ${repo}` }), [repo]);
  const closeBundle = useCallback(() => setBundleOpen(false), []);

  return {
    styles,
    loaded,
    loading,
    busy,
    pending,
    deleting,
    downloadProgressIcon,
    handleLoad,
    showDetectedBundleOptions,
    knownBundle,
    handleOpenBundleOptions,
    bundleHeader,
    bundleOpen,
    closeBundle,
    selected,
    selectedDisplay,
    options,
    handleChange,
    repo,
    action,
    actionHandlers,
    projector,
    projectorPending,
    activeJob,
    handleDiscoveredProjectorChange,
  };
}

type QuantPickerViewState = ReturnType<typeof useQuantPicker>;

function QuantPickerView({ view }: { view: QuantPickerViewState }) {
  if (!view.loaded) return <UnloadedQuantPicker view={view} />;
  return <LoadedQuantPicker view={view} />;
}

function UnloadedQuantPicker({ view }: { view: QuantPickerViewState }) {
  const {
    styles,
    loading,
    busy,
    downloadProgressIcon,
    handleLoad,
    showDetectedBundleOptions,
    knownBundle,
    handleOpenBundleOptions,
    bundleHeader,
    bundleOpen,
    closeBundle,
  } = view;
  return (
    <>
      <View style={styles.rowActions}>
        <Button
          variant="outline"
          size="sm"
          onPress={handleLoad}
          leftIcon={downloadProgressIcon}
          loading={loading}
          disabled={busy}
        >
          Quants
        </Button>
        {showDetectedBundleOptions && knownBundle ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={bundleOptionsIcon}
            onPress={handleOpenBundleOptions}
            disabled={busy}
            accessibilityLabel="Bundle options"
          />
        ) : null}
      </View>
      <AdaptiveModalSheet
        header={bundleHeader}
        visible={bundleOpen}
        onClose={closeBundle}
        desktopMaxWidth={520}
      >
        <View style={styles.managerSection}>
          <LoadingSpinner />
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

function LoadedQuantPicker({ view }: { view: QuantPickerViewState }) {
  const {
    styles,
    busy,
    pending,
    deleting,
    downloadProgressIcon,
    showDetectedBundleOptions,
    handleOpenBundleOptions,
    selected,
    selectedDisplay,
    options,
    handleChange,
    repo,
    action,
    actionHandlers,
    projector,
  } = view;

  return (
    <View style={styles.quantPicker}>
      <View style={styles.quantPickerRow}>
        <SelectField
          field={false}
          label="Quant"
          size="sm"
          value={selected}
          selectedDisplay={selectedDisplay}
          options={options}
          onChange={handleChange}
          placeholder="Choose a quant"
          emptyText="No GGUF quantizations found."
          triggerStyle={styles.quantPickerTrigger}
          testID={`quant-picker-${repo}`}
        />
        <Button
          variant={action === "delete" ? "destructive" : "outline"}
          size="sm"
          onPress={actionHandlers[action]}
          leftIcon={downloadProgressIcon}
          disabled={
            pending ||
            deleting ||
            (action !== "cancel" && (!selected || busy || action === "installed"))
          }
          loading={deleting || pending}
        >
          {action === "installed" ? "Installed" : action[0].toUpperCase() + action.slice(1)}
        </Button>
        {showDetectedBundleOptions && projector ? (
          <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild disabled={busy}>
              <Button
                variant="outline"
                size="sm"
                leftIcon={bundleOptionsIcon}
                onPress={handleOpenBundleOptions}
                disabled={busy}
                accessibilityLabel="Bundle options"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>Bundle options</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      <DiscoveredBundleSheet view={view} />
    </View>
  );
}

function DiscoveredBundleSheet({ view }: { view: QuantPickerViewState }) {
  const {
    styles,
    pending,
    showDetectedBundleOptions,
    bundleHeader,
    bundleOpen,
    closeBundle,
    projector,
    projectorPending,
    activeJob,
    handleDiscoveredProjectorChange,
  } = view;
  if (!showDetectedBundleOptions) return null;
  return (
    <AdaptiveModalSheet
      header={bundleHeader}
      visible={bundleOpen}
      onClose={closeBundle}
      desktopMaxWidth={520}
    >
      {projector ? (
        <View style={styles.rowResponsive}>
          <View style={styles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              Vision projector · {formatBytes(projector.sizeBytes)}
            </Text>
            <Text style={settingsStyles.rowHint}>Adds image understanding</Text>
            <Text style={settingsStyles.rowHint}>{projector.file}</Text>
          </View>
          <Switch
            value={(projector.installed ?? false) || projectorPending}
            disabled={
              pending ||
              (((projector.installed ?? false) || projectorPending) &&
                activeJob?.status === "running")
            }
            onValueChange={handleDiscoveredProjectorChange}
          />
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}
