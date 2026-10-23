import { useStyles } from "./styles";
import { useBrainSurfaceActive } from "../../lifecycle";

import { useBrainOperations } from "../context";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";

import type { BrainCatalogModel, BrainJob } from "../contracts/models";

import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner as LoadingSpinner } from "../theme";
import { Switch } from "@/components/ui/switch";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { settingsStyles } from "@/styles/settings";

import {
  ThemedFavorite,
  ThemedBrainModelFamilyIcon,
  favoriteIcon,
  downloadIcon,
  installedIcon,
  bundleOptionsIcon,
  useReportBrainError,
  formatBytes,
  InlineJobProgress,
  useDownloadSubmission,
} from "./common";
import { QuantPicker } from "./quant-picker";
interface CatalogRowProps {
  serverId: string;
  model: BrainCatalogModel;
  busy: boolean;
  jobs: BrainJob[];
  /** One-click download at the catalog's default quant (no repo to browse). */
  onDownload: (
    id: string,
    components?: string[],
    quant?: string,
    expectedBytes?: number,
  ) => Promise<void>;
  onDownloadQuant: (repo: string, quant: string) => Promise<void>;
  onCancel: (jobId: string) => void;
  showBorder: boolean;
}

export function CatalogRow(props: CatalogRowProps) {
  const view = useCatalogRow(props);
  return <CatalogRowView view={view} />;
}

function useCatalogRow({
  serverId,
  model,
  busy,
  jobs,
  onDownload,
  onDownloadQuant,
  onCancel,
  showBorder,
}: CatalogRowProps) {
  const styles = useStyles();
  const reportError = useReportBrainError();
  const { pending, submit } = useDownloadSubmission();
  const components = useMemo(() => model.components ?? [], [model.components]);
  const isBundle = components.length > 0;
  const [bundleOpen, setBundleOpen] = useState(false);
  const [selectedComponents, setSelectedComponents] = useState<string[]>(() =>
    components
      .filter((component) => component.defaultDownload || component.required)
      .map((component) => component.id),
  );
  const [bundleQuant, setBundleQuant] = useState(model.quant);
  const [bundleQuantBytes, setBundleQuantBytes] = useState(model.sizeBytes ?? 0);
  const [bundleModelId, setBundleModelId] = useState<string | null>(null);
  const client = useBrainOperations();
  const surfaceActive = useBrainSurfaceActive();
  const hasRepo = Boolean(model.repo.trim());
  const handleDownload = useCallback(
    (quant: string, quantBytes: number) => {
      setBundleQuantBytes(quantBytes);
      const componentBytes = selectedComponents.reduce(
        (sum, id) => sum + (components.find((component) => component.id === id)?.bytes ?? 0),
        0,
      );
      return submit(() =>
        onDownload(model.id, selectedComponents, quant, quantBytes + componentBytes),
      );
    },
    [components, model.id, onDownload, selectedComponents, submit],
  );
  const handleDefaultDownload = useCallback(() => {
    void submit(() => onDownload(model.id));
  }, [model.id, onDownload, submit]);
  const refreshComponentAvailability = useCallback(async () => {
    if (!client) return;
    try {
      const inventory = await client.readInventory();
      // A companion belongs to the selected primary, even though a projector
      // can be shared on disk by sibling quants in the same repository.
      const installed =
        inventory.models.find(
          (entry) =>
            entry.repo === model.repo && entry.quant?.toLowerCase() === bundleQuant.toLowerCase(),
        ) ?? inventory.models.find((entry) => entry.repo === model.repo);
      setBundleModelId(installed?.id ?? null);
      const available = new Set(
        installed?.components
          ?.filter((component) => component.available)
          .map((component) => component.id) ?? [],
      );
      setSelectedComponents(
        (model.components ?? [])
          .filter((component) => component.required || available.has(component.id))
          .map((component) => component.id),
      );
    } catch (error) {
      reportError("Unable to refresh bundle components", error);
    }
  }, [bundleQuant, client, model, reportError]);
  const openBundle = useCallback(() => {
    setBundleOpen(true);
    void refreshComponentAvailability();
  }, [refreshComponentAvailability]);
  const directJob = useMemo(
    () => jobs.find((job) => job.kind === "pull" && job.catalogModelId === model.id),
    [jobs, model.id],
  );
  const handleComponentChange = useCallback(
    (componentId: string, enabled: boolean) => {
      const nextComponents = enabled
        ? [...new Set([...selectedComponents, componentId])]
        : selectedComponents.filter((id) => id !== componentId);
      setSelectedComponents(nextComponents);
      if (enabled) {
        // The daemon keeps one logical bundle job per quant. This extends its
        // queue without touching the active transfer, and its supplied total
        // makes the ring span the primary plus every selected companion.
        const componentBytes = nextComponents.reduce(
          (sum, id) => sum + (components.find((component) => component.id === id)?.bytes ?? 0),
          0,
        );
        void submit(() =>
          onDownload(model.id, nextComponents, bundleQuant, bundleQuantBytes + componentBytes),
        );
        return;
      }
      // Do not let an options edit cancel a primary or another queued component.
      // A running artifact finishes as part of the bundle job; its switch is
      // temporarily locked below rather than making cancel the hidden action.
      if (directJob?.status === "running") return;
      if (!client) return;
      void client
        .deleteComponent(bundleModelId ?? model.id, componentId)
        .then(() => refreshComponentAvailability())
        .catch((error) => reportError("Unable to remove the bundle component", error));
    },
    [
      bundleQuant,
      bundleQuantBytes,
      components,
      client,
      bundleModelId,
      directJob,
      model.id,
      onDownload,
      refreshComponentAvailability,
      reportError,
      selectedComponents,
      submit,
    ],
  );

  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [styles, showBorder],
  );
  const meta = [model.params, model.size, model.tier].filter(Boolean).join(" · ");
  // A bundle's primary can complete before an optional companion fails. That
  // file is not a completed bundle, so do not surface an Installed checkmark
  // while the daemon retains the failed job and offers a retry.
  const bundleDownloadFailed = isBundle && directJob?.status === "failed";
  const installed = model.installed && !bundleDownloadFailed;
  useEffect(() => {
    if (!surfaceActive || !bundleOpen || directJob?.status === "running") return;
    void refreshComponentAvailability();
  }, [surfaceActive, bundleOpen, directJob?.status, refreshComponentAvailability]);
  const handleCancel = useCallback(() => {
    if (directJob?.status === "running") onCancel(directJob.id);
  }, [directJob, onCancel]);

  const handleQuantChange = useCallback((quant: string, bytes: number) => {
    setBundleQuant(quant);
    setBundleQuantBytes(bytes);
  }, []);
  const bundleHeader = useMemo(() => ({ title: `Download ${model.name}` }), [model.name]);
  const closeBundle = useCallback(() => setBundleOpen(false), []);
  return {
    styles,
    serverId,
    model,
    busy,
    jobs,
    onDownloadQuant,
    onCancel,
    isBundle,
    hasRepo,
    installed,
    pending,
    directJob,
    handleDownload,
    handleDefaultDownload,
    handleCancel,
    openBundle,
    bundleModelId,
    handleQuantChange,
    rowStyle,
    meta,
    components,
    bundleDownloadFailed,
    bundleOpen,
    bundleHeader,
    closeBundle,
    selectedComponents,
    handleComponentChange,
  };
}

type CatalogRowViewState = ReturnType<typeof useCatalogRow>;

function CatalogActions({ view }: { view: CatalogRowViewState }) {
  const {
    styles,
    serverId,
    model,
    busy,
    jobs,
    onDownloadQuant,
    onCancel,
    isBundle,
    hasRepo,
    installed,
    pending,
    directJob,
    handleDownload,
    handleDefaultDownload,
    handleCancel,
    openBundle,
    bundleModelId,
    handleQuantChange,
  } = view;
  let trailing: ReactElement;
  if (isBundle) {
    trailing = (
      <View style={styles.rowActions}>
        {installed ? (
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Installed</Text>
          </View>
        ) : null}
        <QuantPicker
          serverId={serverId}
          repo={model.repo}
          busy={busy || pending}
          jobs={jobs}
          onDownload={onDownloadQuant}
          onBundleDownload={handleDownload}
          onCancel={onCancel}
          initialQuant={model.quant}
          initialModelId={bundleModelId}
          jobTarget={model.id}
          onQuantChange={handleQuantChange}
          showProgressRing
          showDetectedBundleOptions={false}
        />
        <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild disabled={busy}>
            <Button
              variant="outline"
              size="sm"
              leftIcon={bundleOptionsIcon}
              onPress={openBundle}
              disabled={busy}
              accessibilityLabel="Bundle options"
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>Bundle options</Text>
          </TooltipContent>
        </Tooltip>
      </View>
    );
  } else if (hasRepo) {
    // A repo to browse means a quant choice: pick before downloading, the way
    // Hugging Face search already works, instead of silently grabbing
    // whatever quant the catalog happens to default to. Having one quant
    // installed doesn't mean the repo is "done" - keep the picker so other
    // quants of the same repo stay downloadable, and just flag the one
    // that's already there.
    trailing = (
      <View style={styles.rowActions}>
        {model.installed ? (
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Installed</Text>
          </View>
        ) : null}
        <QuantPicker
          serverId={serverId}
          repo={model.repo}
          busy={busy || pending}
          jobs={jobs}
          onDownload={onDownloadQuant}
          onCancel={onCancel}
          showDetectedBundleOptions={false}
        />
      </View>
    );
  } else if (model.installed) {
    trailing = (
      <View style={styles.installedTag}>
        {installedIcon}
        <Text style={styles.installedTagText}>Installed</Text>
      </View>
    );
  } else {
    trailing = (
      <View style={styles.rowTrailing}>
        <Button
          variant="outline"
          size="sm"
          leftIcon={downloadIcon}
          onPress={directJob?.status === "running" ? handleCancel : handleDefaultDownload}
          disabled={pending || (directJob?.status !== "running" && busy)}
          loading={pending}
        >
          {directJob?.status === "running" ? "Cancel" : "Download"}
        </Button>
        <InlineJobProgress job={directJob} />
      </View>
    );
  }

  return trailing;
}

function CatalogRowView({ view }: { view: CatalogRowViewState }) {
  const {
    styles,
    model,
    isBundle,
    pending,
    directJob,
    rowStyle,
    meta,
    components,
    bundleDownloadFailed,
    bundleOpen,
    bundleHeader,
    closeBundle,
    selectedComponents,
    handleComponentChange,
  } = view;

  return (
    <View style={rowStyle}>
      <View style={styles.modelHeader}>
        <View style={styles.catalogModelName}>
          <ThemedBrainModelFamilyIcon family={model.family} size={18} />
          <Text style={[settingsStyles.rowTitle, styles.modelTitle]} numberOfLines={1}>
            {model.name}
          </Text>
          {model.favorite ? <ThemedFavorite uniProps={favoriteIcon} /> : null}
        </View>
        <CatalogActions view={view} />
      </View>
      <View style={styles.modelDetails}>
        <Text style={settingsStyles.rowHint}>{meta}</Text>
        {model.why ? <Text style={settingsStyles.rowHint}>{model.why}</Text> : null}
        {isBundle ? (
          <Text style={settingsStyles.rowHint}>
            Bundle: {components.map((component) => component.label).join(" · ")}
          </Text>
        ) : null}
        {bundleDownloadFailed && directJob?.error ? (
          <Text style={styles.jobError}>{directJob.error}</Text>
        ) : null}
      </View>
      <AdaptiveModalSheet
        header={bundleHeader}
        visible={bundleOpen}
        onClose={closeBundle}
        desktopMaxWidth={520}
      >
        <View style={styles.managerSection}>
          <Text style={styles.managerHint}>
            These optional files are added to the quant selected on the row.
          </Text>
          {components.map((component) => (
            <CatalogComponentRow
              key={component.id}
              component={component}
              selected={selectedComponents.includes(component.id)}
              pending={pending}
              running={directJob?.status === "running"}
              onChange={handleComponentChange}
            />
          ))}
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

function CatalogComponentRow({
  component,
  selected,
  pending,
  running,
  onChange,
}: {
  component: NonNullable<BrainCatalogModel["components"]>[number];
  selected: boolean;
  pending: boolean;
  running: boolean;
  onChange: (componentId: string, enabled: boolean) => void;
}) {
  const styles = useStyles();
  const handleChange = useCallback(
    (value: boolean) => onChange(component.id, value),
    [component.id, onChange],
  );
  return (
    <View style={styles.rowResponsive}>
      <View style={styles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {component.label}
          {component.bytes ? ` · ${formatBytes(component.bytes)}` : ""}
        </Text>
        <Text style={settingsStyles.rowHint}>{component.description}</Text>
        <Text style={settingsStyles.rowHint}>{component.file}</Text>
      </View>
      <Switch
        value={selected}
        disabled={pending || component.required || (selected && running)}
        onValueChange={handleChange}
      />
    </View>
  );
}

export function CatalogList({
  serverId,
  models,
  loading,
  busy,
  jobs,
  onStarted,
  onCancel,
}: {
  serverId: string;
  models: BrainCatalogModel[];
  loading: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
  onCancel: (jobId: string) => void;
}) {
  const styles = useStyles();
  const client = useBrainOperations();
  const handleDownload = useCallback(
    async (id: string, components?: string[], quant?: string, expectedBytes?: number) => {
      const job = await client.pullModel({ modelId: id, components, quant, expectedBytes });
      onStarted(job);
    },
    [client, onStarted],
  );
  const handleDownloadQuant = useCallback(
    async (repo: string, quant: string) => {
      const job = await client.addModel({ repo, quant, components: [] });
      onStarted(job);
    },
    [client, onStarted],
  );

  if (loading && models.length === 0) {
    return (
      <View style={styles.catalogLoading}>
        <LoadingSpinner size="small" />
      </View>
    );
  }
  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>Models in our catalog</Text>
      {models.map((model, index) => (
        <CatalogRow
          key={model.id}
          serverId={serverId}
          model={model}
          busy={busy}
          jobs={jobs}
          onDownload={handleDownload}
          onDownloadQuant={handleDownloadQuant}
          onCancel={onCancel}
          showBorder={index > 0}
        />
      ))}
    </View>
  );
}

// Hugging Face search + add (gated on features.brainHfSearch)
