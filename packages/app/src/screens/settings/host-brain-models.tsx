import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type {
  BrainCatalogModel,
  BrainHfSearchResult,
  BrainInstalledModel,
  BrainJob,
  BrainRepoQuant,
  BrainRuntime,
} from "@otto-code/protocol/messages";
import {
  CircleCheck,
  Download,
  Gauge,
  HardDrive,
  Play,
  X,
} from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { DaemonClient } from "@otto-code/client";
import type { Theme } from "@/styles/theme";

// ---------------------------------------------------------------------------
// Themed leaf icons (no useUnistyles: banned — see docs/unistyles.md)
// ---------------------------------------------------------------------------

const ThemedTextInput = withUnistyles(TextInput);
const ThemedDownload = withUnistyles(Download);
const ThemedHardDrive = withUnistyles(HardDrive);
const ThemedPlay = withUnistyles(Play);
const ThemedGauge = withUnistyles(Gauge);
const ThemedX = withUnistyles(X);
const ThemedCircleCheck = withUnistyles(CircleCheck);

const foregroundIcon = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const successIcon = (theme: Theme) => ({
  color: theme.colors.palette.green[400],
  size: theme.iconSize.sm,
});

const downloadIcon = <ThemedDownload uniProps={foregroundIcon} />;
const runtimeIcon = <ThemedHardDrive uniProps={foregroundIcon} />;
const runIcon = <ThemedPlay uniProps={foregroundIcon} />;
const gaugeIcon = <ThemedGauge uniProps={foregroundIcon} />;
const cancelIcon = <ThemedX uniProps={foregroundIcon} />;
const installedIcon = <ThemedCircleCheck uniProps={successIcon} />;

// ---------------------------------------------------------------------------
// Data hooks — each shells out (via the daemon) to the otto-brain CLI.
// ---------------------------------------------------------------------------

function useBrainRuntimes(serverId: string, enabled: boolean) {
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

function useBrainScan(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: ["brain-scan", serverId] as const,
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 15_000,
    queryFn: async () => {
      if (!client) throw new Error("Brain host is unavailable");
      return client.brainModelsScan();
    },
  });
}

function useBrainCatalog(serverId: string, enabled: boolean) {
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

function useBrainJobs(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: ["brain-jobs", serverId] as const,
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 1500,
    // While a job is in flight, poll fast enough to feel live.
    refetchInterval: enabled ? 2000 : false,
    queryFn: async () => {
      if (!client) throw new Error("Brain host is unavailable");
      return client.brainJobsList();
    },
  });
}

// When a job finishes, refresh the lists it may have changed (a pull adds an
// installed model and flips a catalog row; an install adds a runtime).
function useRefreshOnJobCompletion(serverId: string, jobs: BrainJob[]): void {
  const queryClient = useQueryClient();
  const prevRunning = useRef(0);
  const running = jobs.filter((job) => job.status === "running").length;
  useEffect(() => {
    if (running < prevRunning.current) {
      void queryClient.invalidateQueries({ queryKey: ["brain-scan", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["brain-catalog", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["brain-runtimes", serverId] });
    }
    prevRunning.current = running;
  }, [running, queryClient, serverId]);
}

function reportError(context: string, error: unknown): void {
  Alert.alert(context, error instanceof Error ? error.message : String(error));
}

// Put a freshly-started job at the head of the cached list (dropping any stale
// entry with the same id) so the UI shows it before the next poll.
function prependJob(prev: BrainJob[] | undefined, job: BrainJob): BrainJob[] {
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

const JOB_STATUS_LABEL: Record<BrainJob["status"], string> = {
  running: "",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

function JobRow({
  job,
  onCancel,
  showBorder,
}: {
  job: BrainJob;
  onCancel: (jobId: string) => void;
  showBorder: boolean;
}) {
  const handleCancel = useCallback(() => onCancel(job.id), [job.id, onCancel]);
  const rowStyle = useMemo(
    () => [styles.jobRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const running = job.status === "running";
  const detail = job.error ?? job.message;
  return (
    <View style={rowStyle}>
      <View style={styles.jobHeader}>
        <Text style={styles.jobLabel} numberOfLines={1}>
          {job.label}
        </Text>
        {running ? (
          <Text style={styles.jobPercent}>{job.percent !== null ? `${job.percent}%` : "…"}</Text>
        ) : (
          <Text style={job.status === "failed" ? styles.jobFailed : styles.jobDone}>
            {JOB_STATUS_LABEL[job.status]}
          </Text>
        )}
      </View>
      {running ? <ProgressBar percent={job.percent} /> : null}
      {detail ? (
        <Text
          style={job.status === "failed" ? styles.jobErrorText : styles.jobMessage}
          numberOfLines={2}
        >
          {detail}
        </Text>
      ) : null}
      {running ? (
        <View style={styles.jobActions}>
          <Button variant="ghost" size="sm" leftIcon={cancelIcon} onPress={handleCancel}>
            Cancel
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function JobsPanel({ serverId, jobs }: { serverId: string; jobs: BrainJob[] }) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const handleCancel = useCallback(
    (jobId: string) => {
      if (!client) return;
      void client
        .brainJobsCancel(jobId)
        .then((next) => {
          queryClient.setQueryData(["brain-jobs", serverId], next);
          return;
        })
        .catch((error) => reportError("Unable to cancel the operation", error));
    },
    [client, queryClient, serverId],
  );

  if (jobs.length === 0) {
    return null;
  }
  return (
    <View style={styles.jobsPanel}>
      {jobs.map((job, index) => (
        <JobRow key={job.id} job={job} onCancel={handleCancel} showBorder={index > 0} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

function RuntimeRow({
  serverId,
  runtimes,
  loading,
  busy,
  onStarted,
}: {
  serverId: string;
  runtimes: BrainRuntime[];
  loading: boolean;
  busy: boolean;
  onStarted: (job: BrainJob) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const installed = runtimes.length > 0;
  const handleInstall = useCallback(() => {
    if (!client) return;
    void client
      .brainRuntimeInstall(null)
      .then(onStarted)
      .catch((error) => reportError("Unable to install the runtime", error));
  }, [client, onStarted]);

  const detail = useMemo(() => {
    if (loading) return "Checking…";
    if (!installed) return "No runtime installed. Install llama.cpp to run models locally.";
    const first = runtimes[0];
    return `${first.label}${first.version ? ` · ${first.version}` : ""} (${first.source})`;
  }, [installed, loading, runtimes]);

  return (
    <View style={settingsStyles.rowResponsive}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Runtime</Text>
        <Text style={settingsStyles.rowHint}>{detail}</Text>
      </View>
      {installed ? (
        <View style={styles.installedTag}>
          {installedIcon}
          <Text style={styles.installedTagText}>Installed</Text>
        </View>
      ) : (
        <Button
          variant="default"
          size="sm"
          leftIcon={runtimeIcon}
          onPress={handleInstall}
          disabled={!client || busy}
          testID="host-brain-install-runtime-button"
        >
          Install
        </Button>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Installed models
// ---------------------------------------------------------------------------

function InstalledModelRow({
  model,
  isDefault,
  onSetDefault,
  showBorder,
}: {
  model: BrainInstalledModel;
  isDefault: boolean;
  onSetDefault: (name: string) => void;
  showBorder: boolean;
}) {
  const handleSetDefault = useCallback(
    () => onSetDefault(model.model),
    [model.model, onSetDefault],
  );
  const rowStyle = useMemo(
    () => [settingsStyles.rowResponsive, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const meta = [model.quant, model.size, model.arch].filter(Boolean).join(" · ");
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.model}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {meta || "Local model"}
        </Text>
      </View>
      {isDefault ? (
        <View style={styles.installedTag}>
          {installedIcon}
          <Text style={styles.installedTagText}>Default</Text>
        </View>
      ) : (
        <Button variant="outline" size="sm" onPress={handleSetDefault}>
          Set default
        </Button>
      )}
    </View>
  );
}

function InstalledModelsList({
  serverId,
  models,
  loading,
}: {
  serverId: string;
  models: BrainInstalledModel[];
  loading: boolean;
}) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const defaultModel = config?.brain.defaultModel ?? null;
  const handleSetDefault = useCallback(
    (name: string) => {
      void patchConfig({ brain: { defaultModel: name } }).catch((error) =>
        reportError("Unable to set the default model", error),
      );
    },
    [patchConfig],
  );

  if (models.length === 0) {
    return (
      <View style={ROW_WITH_BORDER}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Installed models</Text>
          <Text style={settingsStyles.rowHint}>
            {loading ? "Scanning…" : "No models installed yet. Download one below."}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={ROW_SECTION_WITH_BORDER}>
      <Text style={styles.subheading}>Installed models</Text>
      {models.map((model, index) => (
        <InstalledModelRow
          key={model.model}
          model={model}
          isDefault={defaultModel === model.model}
          onSetDefault={handleSetDefault}
          showBorder={index > 0}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Catalog (downloadable)
// ---------------------------------------------------------------------------

function CatalogRow({
  model,
  busy,
  onDownload,
  showBorder,
}: {
  model: BrainCatalogModel;
  busy: boolean;
  onDownload: (id: string) => void;
  showBorder: boolean;
}) {
  const handleDownload = useCallback(() => onDownload(model.id), [model.id, onDownload]);
  const rowStyle = useMemo(
    () => [settingsStyles.rowResponsive, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const meta = [model.params, model.size, model.tier].filter(Boolean).join(" · ");
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {meta}
          {model.why ? ` — ${model.why}` : ""}
        </Text>
      </View>
      {model.installed ? (
        <View style={styles.installedTag}>
          {installedIcon}
          <Text style={styles.installedTagText}>Installed</Text>
        </View>
      ) : (
        <Button
          variant="outline"
          size="sm"
          leftIcon={downloadIcon}
          onPress={handleDownload}
          disabled={busy}
        >
          Download
        </Button>
      )}
    </View>
  );
}

function CatalogList({
  serverId,
  models,
  loading,
  busy,
  onStarted,
}: {
  serverId: string;
  models: BrainCatalogModel[];
  loading: boolean;
  busy: boolean;
  onStarted: (job: BrainJob) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const handleDownload = useCallback(
    (id: string) => {
      if (!client) return;
      void client
        .brainModelsPull(id)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );

  if (loading && models.length === 0) {
    return (
      <View style={ROW_WITH_BORDER}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  return (
    <View style={ROW_SECTION_WITH_BORDER}>
      <Text style={styles.subheading}>Available to download</Text>
      {models.map((model, index) => (
        <CatalogRow
          key={model.id}
          model={model}
          busy={busy}
          onDownload={handleDownload}
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

function QuantRow({
  repo,
  quant,
  size,
  installed,
  busy,
  onDownload,
}: {
  repo: string;
  quant: string;
  size: string;
  installed: boolean;
  busy: boolean;
  onDownload: (repo: string, quant: string) => void;
}) {
  const handleDownload = useCallback(() => onDownload(repo, quant), [repo, quant, onDownload]);
  return (
    <View style={styles.quantRow}>
      <Text style={styles.quantLabel}>{quant}</Text>
      <Text style={styles.quantSize}>{size}</Text>
      {installed ? (
        <View style={styles.installedTag}>
          {installedIcon}
          <Text style={styles.installedTagText}>Installed</Text>
        </View>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={downloadIcon}
          disabled={busy}
          onPress={handleDownload}
        >
          Get
        </Button>
      )}
    </View>
  );
}

function QuantList({
  repo,
  quants,
  loading,
  busy,
  onDownload,
}: {
  repo: string;
  quants: BrainRepoQuant[];
  loading: boolean;
  busy: boolean;
  onDownload: (repo: string, quant: string) => void;
}) {
  if (loading) {
    return (
      <View style={styles.quantList}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (quants.length === 0) {
    return (
      <View style={styles.quantList}>
        <Text style={settingsStyles.rowHint}>No GGUF quantizations found.</Text>
      </View>
    );
  }
  return (
    <View style={styles.quantList}>
      {quants.map((q) => (
        <QuantRow
          key={q.quant}
          repo={repo}
          quant={q.quant}
          size={q.size}
          installed={q.installed}
          busy={busy}
          onDownload={onDownload}
        />
      ))}
    </View>
  );
}

function SearchResultRow({
  result,
  showBorder,
  open,
  quants,
  loadingQuants,
  busy,
  onToggle,
  onDownload,
}: {
  result: BrainHfSearchResult;
  showBorder: boolean;
  open: boolean;
  quants: BrainRepoQuant[];
  loadingQuants: boolean;
  busy: boolean;
  onToggle: (repo: string) => void;
  onDownload: (repo: string, quant: string) => void;
}) {
  const handleToggle = useCallback(() => onToggle(result.repo), [result.repo, onToggle]);
  return (
    <View style={showBorder ? ROW_WITH_BORDER : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {result.repo}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {formatDownloads(result.downloads)} downloads · {result.likes} likes
          {result.gated ? " · gated" : ""}
        </Text>
        {open ? (
          <QuantList
            repo={result.repo}
            quants={quants}
            loading={loadingQuants}
            busy={busy}
            onDownload={onDownload}
          />
        ) : null}
      </View>
      <View style={styles.searchRowActions}>
        {result.installed ? (
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Have</Text>
          </View>
        ) : null}
        <Button variant="outline" size="sm" onPress={handleToggle}>
          {open ? "Hide" : "Quants"}
        </Button>
      </View>
    </View>
  );
}

function HuggingFaceSearch({
  serverId,
  busy,
  onStarted,
}: {
  serverId: string;
  busy: boolean;
  onStarted: (job: BrainJob) => void;
}) {
  const supported = useHostFeature(serverId, "brainHfSearch");
  const client = useHostRuntimeClient(serverId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainHfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const [quants, setQuants] = useState<BrainRepoQuant[]>([]);
  const [loadingQuants, setLoadingQuants] = useState(false);
  // Monotonic request tokens so an out-of-order response from a superseded
  // search/quant-list can't overwrite the current one (which would render one
  // repo's quants under another repo's header — and mis-target Download).
  const searchSeq = useRef(0);
  const quantSeq = useRef(0);

  const runSearch = useCallback(() => {
    if (!client || !query.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setOpenRepo(null);
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

  const toggleQuants = useCallback(
    (repo: string) => {
      if (!client) return;
      if (openRepo === repo) {
        // Collapsing: bump the token so a still-pending response is ignored.
        quantSeq.current++;
        setOpenRepo(null);
        return;
      }
      const seq = ++quantSeq.current;
      setOpenRepo(repo);
      setQuants([]);
      setLoadingQuants(true);
      void client
        .brainHfQuants(repo)
        .then((rows) => {
          if (seq === quantSeq.current) setQuants(rows);
          return;
        })
        .catch((error) => reportError("Could not list quantizations", error))
        .finally(() => {
          if (seq === quantSeq.current) setLoadingQuants(false);
        });
    },
    [client, openRepo],
  );

  const handleDownload = useCallback(
    (repo: string, quant: string) => {
      if (!client) return;
      void client
        .brainModelsAdd(repo, quant)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );

  if (!supported) {
    return null;
  }

  return (
    <View style={ROW_SECTION_WITH_BORDER}>
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
      </View>
      {searching ? (
        <View style={styles.searchLoading}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
      {results.map((r, index) => (
        <SearchResultRow
          key={r.repo}
          result={r}
          showBorder={index > 0}
          open={openRepo === r.repo}
          quants={quants}
          loadingQuants={loadingQuants}
          busy={busy}
          onToggle={toggleQuants}
          onDownload={handleDownload}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Models section
// ---------------------------------------------------------------------------

export function BrainModelsSection({ serverId }: { serverId: string }) {
  const supported = useHostFeature(serverId, "brainManage");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config } = useDaemonConfig(serverId);
  const queryClient = useQueryClient();
  const enabled = supported && isConnected;

  const runtimesQuery = useBrainRuntimes(serverId, enabled);
  const scanQuery = useBrainScan(serverId, enabled);
  const catalogQuery = useBrainCatalog(serverId, enabled);
  const jobsQuery = useBrainJobs(serverId, enabled);

  const runtimes = useMemo(() => runtimesQuery.data ?? [], [runtimesQuery.data]);
  const scanModels = useMemo(() => scanQuery.data ?? [], [scanQuery.data]);
  const catalogModels = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  useRefreshOnJobCompletion(serverId, jobs);
  const busy = jobs.some((job) => job.status === "running");
  const modelJobs = useMemo(
    () => jobs.filter((job) => job.kind === "pull" || job.kind === "runtime-install"),
    [jobs],
  );

  const handleJobStarted = useCallback(
    (job: BrainJob) => {
      queryClient.setQueryData(["brain-jobs", serverId], (prev: BrainJob[] | undefined) =>
        prependJob(prev, job),
      );
    },
    [queryClient, serverId],
  );

  // Only for the local managed brain; a remote brain's models are its own.
  if (!supported || config?.brain.mode === "remote") {
    return null;
  }

  return (
    <SettingsSection title="Models">
      <View style={settingsStyles.card} testID="host-brain-models-card">
        <RuntimeRow
          serverId={serverId}
          runtimes={runtimes}
          loading={runtimesQuery.isLoading}
          busy={busy}
          onStarted={handleJobStarted}
        />
        <InstalledModelsList
          serverId={serverId}
          models={scanModels}
          loading={scanQuery.isLoading}
        />
        <CatalogList
          serverId={serverId}
          models={catalogModels}
          loading={catalogQuery.isLoading}
          busy={busy}
          onStarted={handleJobStarted}
        />
        <HuggingFaceSearch serverId={serverId} busy={busy} onStarted={handleJobStarted} />
        <JobsPanel serverId={serverId} jobs={modelJobs} />
      </View>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Operations (calibrate / sweep / benchmark)
// ---------------------------------------------------------------------------

type OpKind = "calibrate" | "sweep" | "bench";

function startOp(client: DaemonClient, kind: OpKind, model: string | null): Promise<BrainJob> {
  if (kind === "calibrate") return client.brainCalibrate(model ?? "");
  if (kind === "sweep") return client.brainSweep(model ?? "");
  return client.brainBench(model);
}

function OperationRow({
  title,
  hint,
  kind,
  disabled,
  onRun,
  icon,
  testID,
  showBorder,
}: {
  title: string;
  hint: string;
  kind: OpKind;
  disabled: boolean;
  onRun: (kind: OpKind) => void;
  icon: ReactElement;
  testID: string;
  showBorder: boolean;
}) {
  const handleRun = useCallback(() => onRun(kind), [kind, onRun]);
  const rowStyle = useMemo(
    () => [settingsStyles.rowResponsive, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        leftIcon={icon}
        onPress={handleRun}
        disabled={disabled}
        testID={testID}
      >
        Run
      </Button>
    </View>
  );
}

const OP_MODEL_KEY = (value: string | null): string => value ?? "__none__";

export function BrainOperationsSection({ serverId }: { serverId: string }) {
  const supported = useHostFeature(serverId, "brainManage");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config } = useDaemonConfig(serverId);
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const enabled = supported && isConnected;

  const runtimesQuery = useBrainRuntimes(serverId, enabled);
  const scanQuery = useBrainScan(serverId, enabled);
  const jobsQuery = useBrainJobs(serverId, enabled);

  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  // The brain runs one job at a time (see brain-ops-manager); a download counts,
  // so ops are disabled while any job runs. Surface which one so the greyed-out
  // buttons don't read as broken.
  const runningJob = useMemo(() => jobs.find((job) => job.status === "running") ?? null, [jobs]);
  const busy = runningJob !== null;
  const opJobs = useMemo(
    () =>
      jobs.filter(
        (job) => job.kind === "calibrate" || job.kind === "sweep" || job.kind === "bench",
      ),
    [jobs],
  );

  const models = useMemo(() => scanQuery.data ?? [], [scanQuery.data]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const hasRuntime = (runtimesQuery.data ?? []).length > 0;

  const modelOptions = useMemo<SelectFieldOption<string | null>[]>(
    () => models.map((model) => ({ id: model.model, value: model.model, label: model.model })),
    [models],
  );
  const selectedDisplay = useMemo(
    () => (selectedModel ? { label: selectedModel } : null),
    [selectedModel],
  );

  const handleRun = useCallback(
    (kind: OpKind) => {
      if (!client) return;
      if ((kind === "calibrate" || kind === "sweep") && !selectedModel) {
        Alert.alert("Pick a model", "Choose a model to run this on first.");
        return;
      }
      void startOp(client, kind, selectedModel)
        .then((job) => {
          queryClient.setQueryData(["brain-jobs", serverId], (prev: BrainJob[] | undefined) =>
            prependJob(prev, job),
          );
          return;
        })
        .catch((error) => reportError("Unable to start the operation", error));
    },
    [client, queryClient, selectedModel, serverId],
  );

  if (!supported || config?.brain.mode === "remote") {
    return null;
  }

  const opsDisabled = busy || !hasRuntime;

  return (
    <SettingsSection title="Operations">
      <View style={settingsStyles.card} testID="host-brain-operations-card">
        {!hasRuntime ? (
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Runtime required</Text>
              <Text style={settingsStyles.rowHint}>
                Calibrate, sweep, and benchmark load a model on the GPU. Install a runtime and a
                model in Models above first.
              </Text>
            </View>
          </View>
        ) : (
          <View style={settingsStyles.rowResponsive}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Model</Text>
              <Text style={settingsStyles.rowHint}>
                The installed model that calibrate and sweep act on.
              </Text>
            </View>
            <SelectField<string | null>
              field={false}
              size="sm"
              label="Model"
              value={selectedModel}
              selectedDisplay={selectedDisplay}
              options={modelOptions}
              onChange={setSelectedModel}
              placeholder={models.length === 0 ? "No models installed" : "Select a model"}
              emptyText="No models installed"
              disabled={models.length === 0}
              searchable
              getValueKey={OP_MODEL_KEY}
              triggerStyle={styles.opPicker}
              triggerTestID="host-brain-op-model-picker"
            />
          </View>
        )}

        {runningJob ? (
          <View style={ROW_WITH_BORDER}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Waiting on a job</Text>
              <Text style={settingsStyles.rowHint}>
                “{runningJob.label}” is running. The brain runs one job at a time, so operations are
                paused until it finishes.
              </Text>
            </View>
          </View>
        ) : null}

        <OperationRow
          title="Calibrate"
          hint="Measure real KV cache bytes/token so context fit is exact, not a guess."
          kind="calibrate"
          disabled={opsDisabled}
          onRun={handleRun}
          icon={gaugeIcon}
          testID="host-brain-calibrate-button"
          showBorder
        />
        <OperationRow
          title="Sweep"
          hint="Find the reasoning budget that returns content instead of endless thinking."
          kind="sweep"
          disabled={opsDisabled}
          onRun={handleRun}
          icon={runIcon}
          testID="host-brain-sweep-button"
          showBorder
        />
        <OperationRow
          title="Benchmark"
          hint="Run the agentic-coding suite to rank your models. Results appear in the dashboard."
          kind="bench"
          disabled={opsDisabled}
          onRun={handleRun}
          icon={gaugeIcon}
          testID="host-brain-bench-button"
          showBorder
        />
        <JobsPanel serverId={serverId} jobs={opJobs} />
      </View>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  section: {
    paddingTop: theme.spacing[3],
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
  searchRowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantList: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  quantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    minWidth: 84,
  },
  quantSize: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  installedTagText: {
    color: theme.colors.palette.green[400],
    fontSize: theme.fontSize.sm,
  },
  opPicker: {
    minWidth: 200,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
    marginTop: theme.spacing[2],
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  progressIndeterminate: {
    width: "40%",
  },
  jobsPanel: {
    marginTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  jobRow: {
    paddingVertical: theme.spacing[2],
    // Match the horizontal inset of every other row in the card so job
    // labels, progress bars, and messages line up instead of running edge to
    // edge.
    paddingHorizontal: theme.spacing[4],
  },
  jobHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  jobLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  jobPercent: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  jobDone: {
    color: theme.colors.palette.green[400],
    fontSize: theme.fontSize.sm,
  },
  jobFailed: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  jobMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  jobErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  jobActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: theme.spacing[1],
  },
}));

const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];
const ROW_SECTION_WITH_BORDER = [styles.section, settingsStyles.rowBorder];
