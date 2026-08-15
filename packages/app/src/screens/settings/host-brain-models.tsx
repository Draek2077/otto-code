/* oxlint-disable complexity, react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- bundle rows carry id-bound controls */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type {
  BrainCatalogModel,
  BrainHfSearchResult,
  BrainJob,
  BrainRepoQuant,
  BrainRuntime,
} from "@otto-code/protocol/messages";
import {
  CircleCheck,
  Download,
  HardDrive,
  Medal,
  Settings2,
} from "@/components/icons/material-icons";
import { BrainModelFamilyIcon } from "@/components/brain/brain-model-family-icon";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { getDesktopHost } from "@/desktop/host";
import type { Theme } from "@/styles/theme";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import { activeBrainQuantJob, selectInitialBrainQuant } from "./brain-quant-selection";
import { describeRuntimeRemovalError, isRuntimeRemovalAccessDenied } from "./brain-runtime-removal";

// ---------------------------------------------------------------------------
// Themed leaf icons (no useUnistyles: banned - see docs/unistyles.md)
// ---------------------------------------------------------------------------

const ThemedTextInput = withUnistyles(TextInput);
const ThemedDownload = withUnistyles(Download);
const ThemedHardDrive = withUnistyles(HardDrive);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedBundleOptions = withUnistyles(Settings2);
const ThemedFavorite = withUnistyles(Medal);
const ThemedBrainModelFamilyIcon = withUnistyles(BrainModelFamilyIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const foregroundIcon = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const successIcon = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
  size: theme.iconSize.sm,
});
const favoriteIcon = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
  size: 14,
});

const downloadIcon = <ThemedDownload uniProps={foregroundIcon} />;
const runtimeIcon = <ThemedHardDrive uniProps={foregroundIcon} />;
const installedIcon = <ThemedCircleCheck uniProps={successIcon} />;
const bundleOptionsIcon = <ThemedBundleOptions uniProps={foregroundIcon} />;
const runtimeManagerHeader = {
  title: "Manage runtime",
};

// ---------------------------------------------------------------------------
// Data hooks - each shells out (via the daemon) to the otto-brain CLI.
// ---------------------------------------------------------------------------

export function useBrainRuntimes(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: ["brain-runtimes", serverId] as const,
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 15_000,
    queryFn: async () => {
      if (!client) throw new Error("Brain host is unavailable");
      return client.brainRuntimeList();
    },
  });
}

export function useBrainCatalog(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: ["brain-catalog", serverId] as const,
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Brain host is unavailable");
      return client.brainCatalogList();
    },
  });
}

export function useBrainJobs(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: ["brain-jobs", serverId] as const,
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 500,
    // Jobs are a tiny in-memory daemon read. Poll at animation-friendly speed
    // only while downloading; idle Library tabs retain the inexpensive cadence.
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "running") ? 500 : 2000,
    queryFn: async () => {
      if (!client) throw new Error("Brain host is unavailable");
      return client.brainJobsList();
    },
  });
}

// When a job finishes, refresh the lists it may have changed (a pull adds an
// installed model and flips a catalog row; an install adds a runtime).
export function useRefreshOnJobCompletion(serverId: string, jobs: BrainJob[]): void {
  const queryClient = useQueryClient();
  const observedTerminalJobs = useRef(new Set<string>());
  useEffect(() => {
    const newlyTerminal = jobs.filter(
      (job) =>
        job.status !== "running" && !observedTerminalJobs.current.has(`${serverId}:${job.id}`),
    );
    if (newlyTerminal.length === 0) return;
    for (const job of newlyTerminal) observedTerminalJobs.current.add(`${serverId}:${job.id}`);

    void queryClient.invalidateQueries({ queryKey: ["brain-scan", serverId] });
    // The Brain Library owns an installed-model section backed by the joined
    // inventory. Refresh it in the same completion transaction as the older
    // scan so a finished Hugging Face pull never requires a manual refresh.
    void queryClient.invalidateQueries({ queryKey: ["brain-console-inventory", serverId] });
    void queryClient.invalidateQueries({ queryKey: ["brain-catalog", serverId] });
    void queryClient.invalidateQueries({ queryKey: ["brain-runtimes", serverId] });
  }, [jobs, queryClient, serverId]);
}

function reportError(context: string, error: unknown): void {
  // React Native's Alert is a no-op on the Electron/web renderer. Brain model
  // mutations therefore appeared to do nothing when the host rejected them
  // (for example, deleting the currently loaded model). Route every Library
  // failure through the globally mounted dialog instead.
  void alertDialog({
    title: context,
    message: error instanceof Error ? error.message : String(error),
  });
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
}

// Put a freshly-started job at the head of the cached list (dropping any stale
// entry with the same id) so the UI shows it before the next poll.
export function prependJob(prev: BrainJob[] | undefined, job: BrainJob): BrainJob[] {
  const rest = (prev ?? []).filter((existing) => existing.id !== job.id);
  return [job, ...rest];
}

// ---------------------------------------------------------------------------
// Progress + jobs
// ---------------------------------------------------------------------------

function ProgressBar({ percent }: { percent: number | null }) {
  const fillStyle = useMemo(() => {
    if (percent === null) {
      return [styles.progressFill, styles.progressIndeterminate];
    }
    return [styles.progressFill, { width: `${Math.max(2, Math.min(100, percent))}%` as const }];
  }, [percent]);
  return (
    <View style={styles.progressTrack}>
      <View style={fillStyle} />
    </View>
  );
}

/**
 * Just the bar, right under whatever button started the job it belongs to -
 * no label, no percent readout, no message. `jobs.find(...)` at each call
 * site is the whole "is this row downloading" check; nothing else renders
 * the job list, so there is no separate download-manager panel to keep in
 * sync with these bars.
 */
function InlineJobProgress({
  job,
  style,
}: {
  job: BrainJob | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  if (!job || job.status !== "running") {
    return null;
  }
  return (
    <View style={[styles.inlineProgress, style]}>
      <ProgressBar percent={job.percent} />
    </View>
  );
}

const DOWNLOAD_RING_SIZE = 20;
const DOWNLOAD_RING_CENTER = DOWNLOAD_RING_SIZE / 2;
const DOWNLOAD_RING_RADIUS = 8;
const DOWNLOAD_RING_STROKE = 3;
const DOWNLOAD_RING_CIRCUMFERENCE = 2 * Math.PI * DOWNLOAD_RING_RADIUS;
const DOWNLOAD_RING_ROTATE = `rotate(-90 ${DOWNLOAD_RING_CENTER} ${DOWNLOAD_RING_CENTER})`;

function DownloadProgressRing({
  job,
  trackColor,
  progressColor,
}: {
  job: BrainJob | undefined;
  trackColor: string;
  progressColor: string;
}) {
  if (!job || job.status !== "running") return null;

  // A job may not have received a byte count yet. Keep a small visible arc in
  // that short interval instead of implying that the download is complete.
  const percent = Math.max(4, Math.min(100, job.percent ?? 12));
  const dashOffset = DOWNLOAD_RING_CIRCUMFERENCE * (1 - percent / 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Downloading model"
      accessibilityValue={{ now: Math.round(percent), min: 0, max: 100 }}
    >
      <Svg
        width={DOWNLOAD_RING_SIZE}
        height={DOWNLOAD_RING_SIZE}
        viewBox={`0 0 ${DOWNLOAD_RING_SIZE} ${DOWNLOAD_RING_SIZE}`}
        aria-hidden
      >
        <G transform={DOWNLOAD_RING_ROTATE}>
          <Circle
            cx={DOWNLOAD_RING_CENTER}
            cy={DOWNLOAD_RING_CENTER}
            r={DOWNLOAD_RING_RADIUS}
            fill="none"
            stroke={trackColor}
            strokeWidth={DOWNLOAD_RING_STROKE}
          />
          <Circle
            cx={DOWNLOAD_RING_CENTER}
            cy={DOWNLOAD_RING_CENTER}
            r={DOWNLOAD_RING_RADIUS}
            fill="none"
            stroke={progressColor}
            strokeWidth={DOWNLOAD_RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={DOWNLOAD_RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </G>
      </Svg>
    </View>
  );
}

const ThemedDownloadProgressRing = withUnistyles(DownloadProgressRing, (theme: Theme) => ({
  trackColor: theme.colors.surface3,
  progressColor: theme.colors.accent,
}));

function describeRuntimeState({
  activeRuntime,
  answered,
  loading,
}: {
  activeRuntime: BrainRuntime | null;
  answered: boolean;
  loading: boolean;
}): string {
  if (loading) return "Checking…";
  if (!answered) return "This host has not answered, so its runtime is unknown.";
  if (!activeRuntime)
    return "No selected runtime is installed. Install llama.cpp to run models locally.";
  return formatBrainRuntime(activeRuntime);
}

/** One runtime identifier per line. Managed labels already embed their build,
 * so showing both the filesystem slug and version is just duplication. */
export function formatBrainRuntime(runtime: BrainRuntime): string {
  if (runtime.displayName) return runtime.displayName;
  if (runtime.source === "managed") {
    return `${runtime.version || runtime.label} (Otto managed)`;
  }
  const source = runtime.source === "lmstudio" ? "LM Studio" : runtime.source;
  return [runtime.label, runtime.version, source].filter(Boolean).join(" · ");
}

/** The configured path is the source of truth; Automatic resolves to Otto's
 * first-ranked installed runtime. Every Brain surface uses this resolver so
 * inventory order cannot masquerade as the active runtime. */
export function resolveSelectedBrainRuntime(
  runtimes: BrainRuntime[],
  configuredPath: string | null | undefined,
): BrainRuntime | null {
  if (!configuredPath) return runtimes[0] ?? null;
  return runtimes.find((runtime) => runtime.dir === configuredPath) ?? null;
}

function latestRuntimeActionLabel(missing: boolean): string {
  return missing ? "Install latest" : "Update to latest";
}

function runtimePathForFamily(
  family: string,
  selectedRuntime: string,
  runtimes: BrainRuntime[],
): string {
  if (family === "auto") return "auto";
  return selectedRuntime === "auto" ? (runtimes[0]?.dir ?? "auto") : selectedRuntime;
}

function selectedRuntimeInstallState(answered: boolean, activeRuntime: BrainRuntime | null) {
  return {
    installed: answered && activeRuntime !== null,
    missing: answered && activeRuntime === null,
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Three states, not two: unknown, absent, installed.
 *
 * An empty runtime list is only evidence of absence once the host has actually
 * answered. Before that - the daemon is down, the socket is still coming up -
 * `runtimes` is `[]` for want of an answer, and treating that as "not installed"
 * puts an Install call to action in front of a runtime that may well be there.
 * A stopped daemon read exactly like a missing llama.cpp.
 */
export function RuntimeManagerSheet({
  visible,
  onClose,
  serverId,
  runtimes,
  answered,
  loading,
  busy,
  canInstall = true,
  jobs,
  onStarted,
}: {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  runtimes: BrainRuntime[];
  /** True once this host has answered `brainRuntimeList` at least once. */
  answered: boolean;
  loading: boolean;
  busy: boolean;
  /** A remote brain may report its runtime without granting install access. */
  canInstall?: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const [build, setBuild] = useState("");
  const [showSpecificBuild, setShowSpecificBuild] = useState(false);
  const selectedRuntime = config?.brain?.runtime?.path ?? "auto";
  const activeRuntime = useMemo(
    () =>
      resolveSelectedBrainRuntime(runtimes, selectedRuntime === "auto" ? null : selectedRuntime),
    [runtimes, selectedRuntime],
  );
  const { installed, missing } = selectedRuntimeInstallState(answered, activeRuntime);
  const job = useMemo(() => jobs.find((j) => j.kind === "runtime-install"), [jobs]);
  const installedBuildOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      runtimes.map((runtime) => ({
        id: runtime.dir,
        value: runtime.dir,
        label: formatBrainRuntime(runtime),
      })),
    [runtimes],
  );
  const handleRuntimeSelect = useCallback(
    (path: string) => {
      void patchConfig({
        brain: {
          runtime: path === "auto" ? { source: "auto", path: null } : { source: "managed", path },
        },
      });
    },
    [patchConfig],
  );
  const removableRuntimes = useMemo(
    () =>
      runtimes.filter(
        (runtime) => runtime.source === "managed" && runtime.dir !== activeRuntime?.dir,
      ),
    [activeRuntime?.dir, runtimes],
  );
  const removableRuntimeOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      removableRuntimes.map((runtime) => ({
        id: runtime.label,
        value: runtime.label,
        label: formatBrainRuntime(runtime),
      })),
    [removableRuntimes],
  );
  const [removeName, setRemoveName] = useState("");
  const selectedRemovalRuntime = useMemo(
    () => removableRuntimes.find((runtime) => runtime.label === removeName) ?? null,
    [removableRuntimes, removeName],
  );
  const [removalJobId, setRemovalJobId] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [removalNeedsElevation, setRemovalNeedsElevation] = useState(false);
  const [elevatingRemoval, setElevatingRemoval] = useState(false);
  const removalJob = useMemo(
    () => (removalJobId ? (jobs.find((candidate) => candidate.id === removalJobId) ?? null) : null),
    [jobs, removalJobId],
  );
  useEffect(() => {
    if (!removalJob || removalJob.status === "running") return;
    if (removalJob.status === "succeeded") {
      setRemoveName("");
      setRemovalError(null);
      setRemovalNeedsElevation(false);
    } else {
      const error =
        removalJob.error ?? removalJob.message ?? "The runtime removal did not complete.";
      setRemovalError(describeRuntimeRemovalError(error));
      setRemovalNeedsElevation(isRuntimeRemovalAccessDenied(error));
    }
    setRemovalJobId(null);
  }, [removalJob]);
  // A model pull operates only on the model store, so it is safe to remove an
  // unused runtime while it runs. Every other Brain operation can execute the
  // runtime, and the daemon serializes it with removal.
  const removalBlockingJob = useMemo(
    () =>
      jobs.find((operation) => operation.status === "running" && operation.kind !== "pull") ?? null,
    [jobs],
  );
  const handleRemoveRuntime = useCallback(() => {
    if (!client || !selectedRemovalRuntime) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: `Remove ${formatBrainRuntime(selectedRemovalRuntime)}?`,
        message: "This removes the downloaded runtime files from disk. It cannot be undone.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!confirmed) return;
      try {
        setRemovalError(null);
        setRemovalNeedsElevation(false);
        const started = await client.brainRuntimeRemove(selectedRemovalRuntime.label);
        setRemovalJobId(started.id);
        onStarted(started);
      } catch (error) {
        setRemovalError(describeRuntimeRemovalError(error));
        setRemovalNeedsElevation(isRuntimeRemovalAccessDenied(error));
      }
    })();
  }, [client, onStarted, selectedRemovalRuntime]);
  const canElevateRemoval =
    isLocalDaemon &&
    getDesktopHost()?.platform === "win32" &&
    typeof getDesktopHost()?.invoke === "function";
  const handleElevatedRuntimeRemoval = useCallback(() => {
    if (!selectedRemovalRuntime) return;
    const desktop = getDesktopHost();
    const invoke = desktop?.invoke;
    if (!invoke) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: `Remove ${formatBrainRuntime(selectedRemovalRuntime)} as administrator?`,
        message:
          "Windows will ask for administrator permission to remove this runtime's downloaded files. This cannot be undone.",
        confirmLabel: "Request permission",
        destructive: true,
      });
      if (!confirmed) return;
      try {
        setElevatingRemoval(true);
        await invoke("remove_managed_runtime_with_elevation", {
          name: selectedRemovalRuntime.label,
        });
        setRemoveName("");
        setRemovalError(null);
        setRemovalNeedsElevation(false);
        await queryClient.invalidateQueries({ queryKey: ["brain-runtimes", serverId] });
      } catch (error) {
        setRemovalError(describeRuntimeRemovalError(error));
      } finally {
        setElevatingRemoval(false);
      }
    })();
  }, [queryClient, selectedRemovalRuntime, serverId]);
  const handleInstall = useCallback(
    (requestedBuild: string | null = null) => {
      if (!client) return;
      void client
        .brainRuntimeInstall(requestedBuild)
        .then(onStarted)
        .catch((error) => reportError("Unable to install the runtime", error));
    },
    [client, onStarted],
  );
  const handleLatestInstall = useCallback(() => handleInstall("latest"), [handleInstall]);
  const handleBuildInstall = useCallback(
    () => handleInstall(build.trim() || "latest"),
    [build, handleInstall],
  );
  const handleRuntimeFamilyChange = useCallback(
    (value: string) => handleRuntimeSelect(runtimePathForFamily(value, selectedRuntime, runtimes)),
    [handleRuntimeSelect, runtimes, selectedRuntime],
  );
  const handleShowSpecificBuild = useCallback(() => setShowSpecificBuild(true), []);

  const detail = useMemo(
    () => describeRuntimeState({ activeRuntime, answered, loading }),
    [activeRuntime, answered, loading],
  );
  const latestActionLabel = latestRuntimeActionLabel(missing);
  const runtimeFamilyOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: "auto",
        value: "auto",
        label: "Automatic",
        description: "Use the newest compatible managed build, then fall back to LM Studio",
      },
      {
        id: "llama-cpp",
        value: "llama-cpp",
        label: "llama.cpp",
        description: "Pin a specific installed llama.cpp build",
      },
    ],
    [],
  );
  const runtimeFamilyValue = selectedRuntime === "auto" ? "auto" : "llama-cpp";
  const runtimeFamilyDisplay = useMemo(
    () => runtimeFamilyOptions.find((option) => option.value === runtimeFamilyValue) ?? null,
    [runtimeFamilyOptions, runtimeFamilyValue],
  );
  const installedBuildDisplay = useMemo(
    () => installedBuildOptions.find((option) => option.value === selectedRuntime) ?? null,
    [installedBuildOptions, selectedRuntime],
  );
  const removableBuildDisplay = useMemo(
    () => removableRuntimeOptions.find((option) => option.value === removeName) ?? null,
    [removableRuntimeOptions, removeName],
  );

  return (
    <AdaptiveModalSheet
      header={runtimeManagerHeader}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={560}
      testID="brain-runtime-manager"
    >
      <View style={styles.managerSection}>
        <Text style={styles.managerLabel}>Runtime</Text>
        <Text style={styles.managerHint}>
          Automatic uses the newest compatible installed build. Choose llama.cpp only to pin a
          build.
        </Text>
        <SelectField
          field={false}
          label="Runtime family"
          size="sm"
          value={runtimeFamilyValue}
          options={runtimeFamilyOptions}
          onChange={handleRuntimeFamilyChange}
          selectedDisplay={runtimeFamilyDisplay}
          placeholder="Choose a runtime"
          emptyText="No managed runtimes are available."
        />
      </View>

      <View style={styles.managerSection}>
        <Text style={styles.managerLabel}>llama.cpp</Text>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.rowResponsive}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{detail}</Text>
              <Text style={settingsStyles.rowHint}>
                {installed
                  ? "Installed and ready to use"
                  : "Install the latest build to run models locally"}
              </Text>
            </View>
            {installed ? (
              <View style={styles.installedTag}>
                {installedIcon}
                <Text style={styles.installedTagText}>Installed</Text>
              </View>
            ) : null}
          </View>
          {canInstall ? (
            <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Latest build</Text>
                <Text style={settingsStyles.rowHint}>
                  Resolve and install the newest upstream llama.cpp release for this host
                </Text>
              </View>
              <View style={styles.rowTrailing}>
                <Button
                  variant={missing ? "default" : "outline"}
                  size="sm"
                  leftIcon={runtimeIcon}
                  onPress={handleLatestInstall}
                  disabled={!client || busy}
                  testID="host-brain-install-runtime-button"
                >
                  {latestActionLabel}
                </Button>
                <InlineJobProgress job={job} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {canInstall ? (
        <View style={styles.managerSection}>
          {!showSpecificBuild ? (
            <Button variant="ghost" size="sm" onPress={handleShowSpecificBuild}>
              Use a specific build
            </Button>
          ) : (
            <>
              <Text style={styles.managerLabel}>Specific build</Text>
              <Text style={styles.managerHint}>
                Pin a named build for troubleshooting or a known compatibility requirement
              </Text>
              <View style={styles.specificBuildRow}>
                <ThemedTextInput
                  value={build}
                  onChangeText={setBuild}
                  placeholder="Build tag, for example b10355"
                  autoCapitalize="none"
                  style={styles.runtimeBuildInput}
                  accessibilityLabel="Specific llama.cpp build"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={handleBuildInstall}
                  disabled={!client || busy}
                >
                  Install build
                </Button>
              </View>
              {installedBuildOptions.length > 0 ? (
                <SelectField
                  field={false}
                  label="Installed build"
                  size="sm"
                  value={selectedRuntime}
                  options={installedBuildOptions}
                  onChange={handleRuntimeSelect}
                  selectedDisplay={installedBuildDisplay}
                  placeholder="Choose an installed build"
                  emptyText="No installed builds are available."
                />
              ) : null}
              {removableRuntimes.length > 0 ? (
                <>
                  <View style={styles.specificBuildRow}>
                    <SelectField
                      field={false}
                      label="Remove an installed build"
                      size="sm"
                      value={removeName}
                      options={removableRuntimeOptions}
                      onChange={(value) => {
                        setRemoveName(value);
                        setRemovalError(null);
                        setRemovalNeedsElevation(false);
                      }}
                      selectedDisplay={removableBuildDisplay}
                      placeholder="Choose a build to remove"
                      emptyText="No removable builds are available."
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={handleRemoveRuntime}
                      disabled={
                        !client ||
                        !selectedRemovalRuntime ||
                        removalBlockingJob !== null ||
                        elevatingRemoval
                      }
                    >
                      {removalBlockingJob?.kind === "runtime-remove" ? "Removing..." : "Remove"}
                    </Button>
                  </View>
                  {removalBlockingJob && selectedRemovalRuntime ? (
                    <Text style={styles.managerHint}>
                      Finish {removalBlockingJob.label} before removing a runtime
                    </Text>
                  ) : null}
                  {removalError ? <Text style={styles.jobError}>{removalError}</Text> : null}
                  {removalNeedsElevation && canElevateRemoval && selectedRemovalRuntime ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onPress={handleElevatedRuntimeRemoval}
                      loading={elevatingRemoval}
                      disabled={elevatingRemoval || removalBlockingJob !== null}
                    >
                      Remove with administrator permission
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

// ---------------------------------------------------------------------------
// Installed models
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Catalog (downloadable)
// ---------------------------------------------------------------------------

function CatalogRow({
  serverId,
  model,
  busy,
  jobs,
  onDownload,
  onDownloadQuant,
  onCancel,
  showBorder,
}: {
  serverId: string;
  model: BrainCatalogModel;
  busy: boolean;
  jobs: BrainJob[];
  /** One-click download at the catalog's default quant (no repo to browse). */
  onDownload: (id: string, components?: string[], quant?: string, expectedBytes?: number) => void;
  onDownloadQuant: (repo: string, quant: string) => void;
  onCancel: (jobId: string) => void;
  showBorder: boolean;
}) {
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
  const client = useHostRuntimeClient(serverId);
  const hasRepo = Boolean(model.repo.trim());
  const handleDownload = useCallback(
    (quant: string, quantBytes: number) => {
      setBundleQuantBytes(quantBytes);
      const componentBytes = selectedComponents.reduce(
        (sum, id) => sum + (components.find((component) => component.id === id)?.bytes ?? 0),
        0,
      );
      onDownload(model.id, selectedComponents, quant, quantBytes + componentBytes);
    },
    [components, model.id, onDownload, selectedComponents],
  );
  const handleDefaultDownload = useCallback(() => onDownload(model.id), [model.id, onDownload]);
  const refreshComponentAvailability = useCallback(async () => {
    if (!client) return;
    try {
      const inventory = await client.brainModelsInventory();
      // A companion belongs to the selected primary, even though a projector
      // can be shared on disk by sibling quants in the same repository.
      const installed =
        inventory.models.find(
          (entry) =>
            entry.id.startsWith(`${model.repo}/`) &&
            entry.quant?.toLowerCase() === bundleQuant.toLowerCase(),
        ) ?? inventory.models.find((entry) => entry.id.startsWith(`${model.repo}/`));
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
  }, [bundleQuant, client, model]);
  const openBundle = useCallback(() => {
    setBundleOpen(true);
    void refreshComponentAvailability();
  }, [refreshComponentAvailability]);
  const directJob = useMemo(
    () => jobs.find((job) => job.kind === "pull" && job.target === model.id),
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
        onDownload(model.id, nextComponents, bundleQuant, bundleQuantBytes + componentBytes);
        return;
      }
      // Do not let an options edit cancel a primary or another queued component.
      // A running artifact finishes as part of the bundle job; its switch is
      // temporarily locked below rather than making cancel the hidden action.
      if (directJob?.status === "running") return;
      if (!client) return;
      void client
        .brainModelComponentDelete(bundleModelId ?? model.id, componentId)
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
      selectedComponents,
    ],
  );

  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const meta = [model.params, model.size, model.tier].filter(Boolean).join(" · ");
  // A bundle's primary can complete before an optional companion fails. That
  // file is not a completed bundle, so do not surface an Installed checkmark
  // while the daemon retains the failed job and offers a retry.
  const bundleDownloadFailed = isBundle && directJob?.status === "failed";
  const installed = model.installed && !bundleDownloadFailed;
  useEffect(() => {
    if (!bundleOpen || directJob?.status === "running") return;
    void refreshComponentAvailability();
  }, [bundleOpen, directJob?.status, refreshComponentAvailability]);
  const handleCancel = useCallback(() => {
    if (directJob?.status === "running") onCancel(directJob.id);
  }, [directJob, onCancel]);

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
          busy={busy}
          jobs={jobs}
          onDownload={onDownloadQuant}
          onBundleDownload={handleDownload}
          onCancel={onCancel}
          initialQuant={model.quant}
          initialModelId={bundleModelId}
          jobTarget={model.id}
          onQuantChange={(quant, bytes) => {
            setBundleQuant(quant);
            setBundleQuantBytes(bytes);
          }}
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
          busy={busy}
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
          disabled={directJob?.status !== "running" && busy}
        >
          {directJob?.status === "running" ? "Cancel" : "Download"}
        </Button>
        <InlineJobProgress job={directJob} />
      </View>
    );
  }

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
        {trailing}
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
        header={{ title: `Download ${model.name}` }}
        visible={bundleOpen}
        onClose={() => setBundleOpen(false)}
        desktopMaxWidth={520}
      >
        <View style={styles.managerSection}>
          <Text style={styles.managerHint}>
            These optional files are added to the quant selected on the row.
          </Text>
          {components.map((component) => {
            const selected = selectedComponents.includes(component.id);
            return (
              <View key={component.id} style={settingsStyles.rowResponsive}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {component.label}
                    {component.bytes ? ` · ${formatBytes(component.bytes)}` : ""}
                  </Text>
                  <Text style={settingsStyles.rowHint}>{component.description}</Text>
                  <Text style={settingsStyles.rowHint}>{component.file}</Text>
                </View>
                <Switch
                  value={selected}
                  disabled={component.required || (selected && directJob?.status === "running")}
                  onValueChange={(value) => handleComponentChange(component.id, value)}
                />
              </View>
            );
          })}
        </View>
      </AdaptiveModalSheet>
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
  const client = useHostRuntimeClient(serverId);
  const handleDownload = useCallback(
    (id: string, components?: string[], quant?: string, expectedBytes?: number) => {
      if (!client) return;
      void client
        .brainModelsPull(id, components, quant, expectedBytes)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );
  const handleDownloadQuant = useCallback(
    (repo: string, quant: string) => {
      if (!client) return;
      void client
        .brainModelsAdd(repo, quant, [])
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
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

// ---------------------------------------------------------------------------
// Hugging Face search + add (gated on features.brainHfSearch)
// ---------------------------------------------------------------------------

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

const searchPlaceholderProps = (theme: Theme) => ({
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

function withoutInventoryModel(
  previous: { models: { id: string }[]; disk: unknown } | undefined,
  modelId: string,
) {
  if (!previous) return previous;
  return { ...previous, models: previous.models.filter((model) => model.id !== modelId) };
}

function markQuantRemoved(quants: BrainRepoQuant[], quantName: string): BrainRepoQuant[] {
  return quants.map((quant) =>
    quant.quant === quantName ? { ...quant, installed: false, modelId: null } : quant,
  );
}

/** A local event in the app cache, so every open quant picker reloads after a model mutation. */
function useBrainModelRevision(serverId: string): number {
  const query = useFetchQuery({
    queryKey: ["brain-model-revision", serverId] as const,
    dataShape: "value",
    staleTimeMs: 60_000,
    queryFn: async () => 0,
  });
  return query.data ?? 0;
}

function QuantPicker({
  serverId,
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
}: {
  serverId: string;
  repo: string;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (repo: string, quant: string, components?: string[], expectedBytes?: number) => void;
  /** Bundles keep this quant picker but attach the checked companion files. */
  onBundleDownload?: (quant: string, quantBytes: number) => void;
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
}) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const modelRevision = useBrainModelRevision(serverId);
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
      const rows = await client.brainHfQuants(repo);
      if (seq === requestSeq.current) {
        setQuants(rows);
        setLoaded(true);
      }
    } catch (error) {
      reportError("Could not list quantizations", error);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [client, repo]);
  const handleOpenBundleOptions = useCallback(() => {
    setBundleOpen(true);
    if (!loaded) void handleLoad();
  }, [handleLoad, loaded]);

  // Reopen the picker on its own if this repo already has a pull running -
  // otherwise remounting (tab switch, navigating away and back) leaves the
  // user staring at a disabled button with no way to see their download is
  // still going.
  useEffect(() => {
    if (activeJob && !loaded) handleLoad();
  }, [activeJob, loaded, handleLoad]);

  useEffect(() => {
    if (!loaded || observedRevision.current === modelRevision) return;
    observedRevision.current = modelRevision;
    void handleLoad();
  }, [handleLoad, loaded, modelRevision]);

  useEffect(() => {
    if (!bundleOpen || activeJob?.status === "running") return;
    setProjectorPending(false);
    void handleLoad();
  }, [activeJob?.status, bundleOpen, handleLoad]);

  // Once the quant list loads, prefer an installed quant so a reopened picker
  // immediately offers its useful Delete action. A running job still wins: its
  // target is the only quant whose progress/cancel state this row can show.
  useEffect(() => {
    if (!loaded || selected !== null) return;
    const activeQuant = jobTarget
      ? initialQuant
      : (activeJob?.target?.slice(repo.length + 1) ?? null);
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
    if (onBundleDownload) onBundleDownload(selected, selectedQuant?.sizeBytes ?? 0);
    else onDownload(repo, selected, [], selectedQuant?.sizeBytes ?? 0);
  }, [onBundleDownload, onDownload, repo, selected, selectedQuant?.sizeBytes]);
  const handleDiscoveredProjectorChange = useCallback(
    (enabled: boolean) => {
      if (!selected || !projector) return;
      if (enabled) {
        setProjectorPending(true);
        onDownload(
          repo,
          selected,
          ["vision-projector"],
          (selectedQuant?.sizeBytes ?? 0) + projector.sizeBytes,
        );
        return;
      }
      setProjectorPending(false);
      // A bundle options edit must never stop the selected quant transfer.
      if (activeJob?.status === "running") return;
      if (!client || !selectedModelId) return;
      void client
        .brainModelComponentDelete(selectedModelId, "vision-projector")
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
        await client.brainModelDelete(modelId);
        // Make every Library consumer agree immediately. The authoritative
        // rescan has already completed before the delete RPC resolves; this
        // optimistic cache update prevents a stale row or picker from briefly
        // presenting the removed quant as still installed.
        queryClient.setQueryData(
          ["brain-console-inventory", serverId],
          (previous: { models: { id: string }[]; disk: unknown } | undefined) =>
            withoutInventoryModel(previous, modelId),
        );
        setQuants((previous) => markQuantRemoved(previous, selectedQuant.quant));
        queryClient.setQueryData<number>(
          ["brain-model-revision", serverId],
          (revision = 0) => revision + 1,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["brain-catalog", serverId] }),
          queryClient.invalidateQueries({ queryKey: ["brain-console-inventory", serverId] }),
          queryClient.invalidateQueries({ queryKey: ["brain-scan", serverId] }),
          queryClient.invalidateQueries({ queryKey: ["brain-runtimes", serverId] }),
        ]);
      } catch (error) {
        reportError("Unable to delete the model", error);
      } finally {
        setDeleting(false);
      }
    })();
  }, [client, queryClient, repo, selectedModelId, selectedQuant, serverId]);
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

  if (!loaded) {
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
          header={{ title: `Bundle options for ${repo}` }}
          visible={bundleOpen}
          onClose={() => setBundleOpen(false)}
          desktopMaxWidth={520}
        >
          <View style={styles.managerSection}>
            <LoadingSpinner />
          </View>
        </AdaptiveModalSheet>
      </>
    );
  }

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
            deleting || (action !== "cancel" && (!selected || busy || action === "installed"))
          }
          loading={deleting}
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
      {showDetectedBundleOptions ? (
        <AdaptiveModalSheet
          header={{ title: `Bundle options for ${repo}` }}
          visible={bundleOpen}
          onClose={() => setBundleOpen(false)}
          desktopMaxWidth={520}
        >
          {projector ? (
            <View style={settingsStyles.rowResponsive}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  Vision projector · {formatBytes(projector.sizeBytes)}
                </Text>
                <Text style={settingsStyles.rowHint}>Adds image understanding</Text>
                <Text style={settingsStyles.rowHint}>{projector.file}</Text>
              </View>
              <Switch
                value={(projector.installed ?? false) || projectorPending}
                disabled={
                  ((projector.installed ?? false) || projectorPending) &&
                  activeJob?.status === "running"
                }
                onValueChange={handleDiscoveredProjectorChange}
              />
            </View>
          ) : null}
        </AdaptiveModalSheet>
      ) : null}
    </View>
  );
}

function SearchResultRow({
  serverId,
  result,
  showBorder,
  busy,
  jobs,
  onDownload,
  onCancel,
}: {
  serverId: string;
  result: BrainHfSearchResult;
  showBorder: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (repo: string, quant: string, components?: string[], expectedBytes?: number) => void;
  onCancel: (jobId: string) => void;
}) {
  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  return (
    <View style={rowStyle}>
      <View style={styles.modelHeader}>
        <Text style={[settingsStyles.rowTitle, styles.modelTitle]} numberOfLines={1}>
          {result.repo}
        </Text>
        <View style={styles.rowActions}>
          <QuantPicker
            serverId={serverId}
            repo={result.repo}
            busy={busy}
            jobs={jobs}
            onDownload={onDownload}
            onCancel={onCancel}
          />
        </View>
      </View>
      <View style={styles.modelDetails}>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {formatDownloads(result.downloads)} downloads · {result.likes} likes
          {result.gated ? " · gated" : ""}
        </Text>
        {result.summary ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {result.summary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PinnedModelRow({
  serverId,
  model,
  showBorder,
  busy,
  jobs,
  onDownload,
  onCancel,
}: {
  serverId: string;
  model: PinnedHuggingFaceModel;
  showBorder: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (repo: string, quant: string, components?: string[], expectedBytes?: number) => void;
  onCancel: (jobId: string) => void;
}) {
  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const meta = [model.quant, model.sizeBytes ? formatBytes(model.sizeBytes) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={rowStyle}>
      <View style={styles.modelHeader}>
        <Text style={[settingsStyles.rowTitle, styles.modelTitle]} numberOfLines={1}>
          {model.name}
        </Text>
        <View style={styles.rowActions}>
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Installed</Text>
          </View>
          {model.repo ? (
            <QuantPicker
              serverId={serverId}
              repo={model.repo}
              initialQuant={model.quant}
              initialModelId={model.id}
              knownBundle={model.hasProjector}
              busy={busy}
              jobs={jobs}
              onDownload={onDownload}
              onCancel={onCancel}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.modelDetails}>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {meta || "Hugging Face source unavailable"}
        </Text>
        {model.hasProjector ? (
          <Text style={settingsStyles.rowHint}>Bundle: Vision projector</Text>
        ) : null}
      </View>
    </View>
  );
}

export function HuggingFaceSearch({
  serverId,
  busy,
  jobs,
  onStarted,
  onCancel,
}: {
  serverId: string;
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
  onCancel: (jobId: string) => void;
}) {
  const supported = useHostFeature(serverId, "brainHfSearch");
  const client = useHostRuntimeClient(serverId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainHfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // A monotonic request token so an out-of-order search response from a
  // superseded query (or one abandoned via Clear) can't overwrite the current
  // results.
  const searchSeq = useRef(0);
  const hasSearched = query.length > 0 || results.length > 0;

  const runSearch = useCallback(() => {
    if (!client || !query.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    void client
      .brainHfSearch(query.trim(), 30)
      .then((rows) => {
        if (seq === searchSeq.current) setResults(rows);
        return;
      })
      .catch((error) => reportError("Search failed", error))
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, [client, query]);

  const handleClear = useCallback(() => {
    searchSeq.current++;
    setQuery("");
    setResults([]);
    setSearching(false);
  }, []);

  const handleDownload = useCallback(
    (repo: string, quant: string, components?: string[], expectedBytes?: number) => {
      if (!client) return;
      void client
        .brainModelsAdd(repo, quant, components, undefined, expectedBytes)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );

  if (!supported) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>Search Hugging Face</Text>
      <View style={styles.searchRow}>
        <ThemedTextInput
          style={styles.searchInput}
          uniProps={searchPlaceholderProps}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          placeholder="Search GGUF models…"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          variant="outline"
          size="sm"
          onPress={runSearch}
          disabled={!query.trim() || searching}
        >
          Search
        </Button>
        {hasSearched ? (
          <Button variant="ghost" size="sm" onPress={handleClear}>
            Clear
          </Button>
        ) : null}
      </View>
      {searching ? (
        <View style={styles.searchLoading}>
          <LoadingSpinner size="small" />
        </View>
      ) : null}
      {results.map((r, index) => (
        <SearchResultRow
          key={r.repo}
          serverId={serverId}
          result={r}
          showBorder={index > 0}
          busy={busy}
          jobs={jobs}
          onDownload={handleDownload}
          onCancel={onCancel}
        />
      ))}
    </View>
  );
}

/** A persistent download library, deliberately separate from search results. */
export function DownloadedHuggingFaceModels({
  serverId,
  models,
  busy,
  jobs,
  onStarted,
  onCancel,
}: {
  serverId: string;
  models: PinnedHuggingFaceModel[];
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
  onCancel: (jobId: string) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const handleDownload = useCallback(
    (repo: string, quant: string, components?: string[], expectedBytes?: number) => {
      if (!client) return;
      void client
        .brainModelsAdd(repo, quant, components, undefined, expectedBytes)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );

  if (models.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>Downloaded models</Text>
      {models.map((model, index) => (
        <PinnedModelRow
          key={model.id}
          serverId={serverId}
          model={model}
          showBorder={index > 0}
          busy={busy}
          jobs={jobs}
          onDownload={handleDownload}
          onCancel={onCancel}
        />
      ))}
    </View>
  );
}

// The "Models" and "Operations" settings sections that used to live here are
// gone. Downloading a model, installing a runtime, calibrating VRAM, sweeping a
// reasoning budget and running a benchmark are work, not settings, and they now
// live on the Brain page (`screens/brain/`), which composes the components above
// directly. What remains in this file is those building blocks.

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingVertical: theme.spacing[3],
  },
  subheading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: theme.spacing[1],
    // Align the subheading text with the row content below it, which sits at
    // `spacing[4]` of horizontal padding (rowResponsive). Without this the
    // heading hangs off the card's left edge while the rows are indented.
    paddingHorizontal: theme.spacing[4],
  },
  installedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  searchInput: {
    flex: 1,
    height: 36,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  searchLoading: {
    paddingVertical: theme.spacing[3],
    alignItems: "center",
  },
  catalogLoading: {
    paddingVertical: theme.spacing[3],
    alignItems: "center",
  },
  // Shared by the catalog row's "Installed" badge + QuantPicker pairing and
  // the search row's "Installed" badge + QuantPicker pairing.
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantPicker: {
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  quantPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantPickerTrigger: {
    minWidth: 160,
  },
  installedTagText: {
    color: theme.colors.palette.green[400],
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  // Catalog and search rows: same shape as `settingsStyles.rowResponsive` but
  // with a tighter vertical rhythm - these lists are read a row at a time,
  // scanning for a name, not a settings form.
  tightRow: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  modelHeader: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: { xs: "stretch", sm: "center" },
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  modelTitle: {
    flex: 1,
    minWidth: 0,
  },
  catalogModelName: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  modelDetails: {
    gap: theme.spacing[1],
  },
  // A trailing button with its own progress bar directly beneath it, once a
  // job is running for that specific row - never a separate panel elsewhere
  // on the page.
  rowTrailing: {
    alignItems: "center",
    gap: theme.spacing[1],
  },
  runtimeBuildInput: {
    flex: 1,
    minWidth: 156,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
  managerSection: {
    gap: theme.spacing[2],
  },
  managerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  managerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  jobError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  specificBuildRow: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: { xs: "stretch", sm: "flex-end" },
    gap: theme.spacing[2],
  },
  inlineProgress: {
    width: 96,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  progressIndeterminate: {
    width: "40%",
  },
}));
