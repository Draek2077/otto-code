import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
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
import { CircleCheck, Download, HardDrive } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

// ---------------------------------------------------------------------------
// Themed leaf icons (no useUnistyles: banned - see docs/unistyles.md)
// ---------------------------------------------------------------------------

const ThemedTextInput = withUnistyles(TextInput);
const ThemedDownload = withUnistyles(Download);
const ThemedHardDrive = withUnistyles(HardDrive);
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
const installedIcon = <ThemedCircleCheck uniProps={successIcon} />;

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
export function useRefreshOnJobCompletion(serverId: string, jobs: BrainJob[]): void {
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
function InlineJobProgress({ job }: { job: BrainJob | undefined }) {
  if (!job || job.status !== "running") {
    return null;
  }
  return (
    <View style={styles.inlineProgress}>
      <ProgressBar percent={job.percent} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function RuntimeRow({
  serverId,
  runtimes,
  loading,
  busy,
  jobs,
  onStarted,
}: {
  serverId: string;
  runtimes: BrainRuntime[];
  loading: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const installed = runtimes.length > 0;
  const job = useMemo(() => jobs.find((j) => j.kind === "runtime-install"), [jobs]);
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
        <View style={styles.rowTrailing}>
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
          <InlineJobProgress job={job} />
        </View>
      )}
    </View>
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
  showBorder,
}: {
  serverId: string;
  model: BrainCatalogModel;
  busy: boolean;
  jobs: BrainJob[];
  /** One-click download at the catalog's default quant (no repo to browse). */
  onDownload: (id: string) => void;
  onDownloadQuant: (repo: string, quant: string) => void;
  showBorder: boolean;
}) {
  const hasRepo = Boolean(model.repo.trim());
  const handleDownload = useCallback(() => onDownload(model.id), [model.id, onDownload]);

  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const meta = [model.params, model.size, model.tier].filter(Boolean).join(" · ");
  const directJob = useMemo(
    () => jobs.find((j) => j.kind === "pull" && j.target === model.id),
    [jobs, model.id],
  );

  let trailing: ReactElement;
  if (hasRepo) {
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
          onPress={handleDownload}
          disabled={busy}
        >
          Download
        </Button>
        <InlineJobProgress job={directJob} />
      </View>
    );
  }

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.name}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {meta}
          {model.why ? ` - ${model.why}` : ""}
        </Text>
      </View>
      {trailing}
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
}: {
  serverId: string;
  models: BrainCatalogModel[];
  loading: boolean;
  busy: boolean;
  jobs: BrainJob[];
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
  const handleDownloadQuant = useCallback(
    (repo: string, quant: string) => {
      if (!client) return;
      void client
        .brainModelsAdd(repo, quant)
        .then(onStarted)
        .catch((error) => reportError("Unable to start the download", error));
    },
    [client, onStarted],
  );

  if (loading && models.length === 0) {
    return (
      <View style={settingsStyles.row}>
        <ActivityIndicator size="small" />
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
function QuantPicker({
  serverId,
  repo,
  busy,
  jobs,
  onDownload,
}: {
  serverId: string;
  repo: string;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (repo: string, quant: string) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quants, setQuants] = useState<BrainRepoQuant[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Found by matching the job's target prefix rather than `selected`, so a
  // pull started before this component last mounted (e.g. before a tab
  // switch away and back) is still found here even though `selected` and
  // `loaded` have reset to their initial values.
  const activeJob = useMemo(
    () => jobs.find((j) => j.kind === "pull" && (j.target?.startsWith(`${repo}#`) ?? false)),
    [jobs, repo],
  );

  const handleLoad = useCallback(() => {
    if (!client || loading) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    void client
      .brainHfQuants(repo)
      .then((rows) => {
        if (seq !== requestSeq.current) return;
        setQuants(rows);
        setLoaded(true);
        return;
      })
      .catch((error) => reportError("Could not list quantizations", error))
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [client, loading, repo]);

  // Reopen the picker on its own if this repo already has a pull running -
  // otherwise remounting (tab switch, navigating away and back) leaves the
  // user staring at a disabled button with no way to see their download is
  // still going.
  useEffect(() => {
    if (activeJob && !loaded) handleLoad();
  }, [activeJob, loaded, handleLoad]);

  // Once the quant list loads, default the selection to whichever quant is
  // actually downloading so the dropdown and the progress bar agree.
  useEffect(() => {
    if (!loaded || !activeJob || selected !== null) return;
    const quant = activeJob.target?.slice(repo.length + 1);
    if (quant) setSelected(quant);
  }, [loaded, activeJob, repo, selected]);

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
  const alreadyInstalled = selectedQuant?.installed ?? false;
  const handleChange = useCallback((value: string) => setSelected(value), []);
  const handleDownload = useCallback(() => {
    if (selected) onDownload(repo, selected);
  }, [onDownload, repo, selected]);
  const selectedDisplay = useMemo(
    () =>
      selectedOption
        ? { label: selectedOption.label, description: selectedOption.description }
        : null,
    [selectedOption],
  );

  if (!loaded) {
    return (
      <View style={styles.rowTrailing}>
        <Button variant="outline" size="sm" onPress={handleLoad} loading={loading} disabled={busy}>
          Quants
        </Button>
        <InlineJobProgress job={activeJob} />
      </View>
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
          variant="outline"
          size="sm"
          onPress={handleDownload}
          disabled={!selected || busy || alreadyInstalled}
        >
          {alreadyInstalled ? "Installed" : "Download"}
        </Button>
      </View>
      <InlineJobProgress job={activeJob} />
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
}: {
  serverId: string;
  result: BrainHfSearchResult;
  showBorder: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (repo: string, quant: string) => void;
}) {
  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {result.repo}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {formatDownloads(result.downloads)} downloads · {result.likes} likes
          {result.gated ? " · gated" : ""}
        </Text>
      </View>
      <View style={styles.rowActions}>
        {result.installed ? (
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Installed</Text>
          </View>
        ) : null}
        <QuantPicker
          serverId={serverId}
          repo={result.repo}
          busy={busy}
          jobs={jobs}
          onDownload={onDownload}
        />
      </View>
    </View>
  );
}

export function HuggingFaceSearch({
  serverId,
  busy,
  jobs,
  onStarted,
}: {
  serverId: string;
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
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
          <ActivityIndicator size="small" />
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
  // Catalog and search rows: same shape as `settingsStyles.rowResponsive` but
  // with a tighter vertical rhythm - these lists are read a row at a time,
  // scanning for a name, not a settings form.
  tightRow: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: { xs: theme.spacing[2], sm: 0 },
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  // A trailing button with its own progress bar directly beneath it, once a
  // job is running for that specific row - never a separate panel elsewhere
  // on the page.
  rowTrailing: {
    alignItems: "center",
    gap: theme.spacing[1],
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
