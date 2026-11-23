import { useStyles } from "./styles";

import { useBrainOperations, useBrainHost, useBrainPreferences } from "../context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Text, View } from "react-native";

import type { BrainJob, BrainRuntime } from "../contracts/models";

import { Button } from "@/components/ui/button";

import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";

import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { settingsStyles } from "@/styles/settings";

import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveHostSelectedBrainRuntime } from "../runtime-management";

import { describeRuntimeRemovalError, isRuntimeRemovalAccessDenied } from "./runtime-removal";
import {
  ThemedTextInput,
  runtimeIcon,
  installedIcon,
  runtimeManagerHeader,
  useReportBrainError,
  InlineJobProgress,
} from "./common";
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

/** The host-issued selection id is the source of truth; Automatic resolves to Otto's
 * first-ranked installed runtime. Every Brain surface uses this resolver so
 * inventory order cannot masquerade as the active runtime. */
export function resolveSelectedBrainRuntime(
  runtimes: BrainRuntime[],
  configuredId: string | null | undefined,
): BrainRuntime | null {
  if (!configuredId) return runtimes[0] ?? null;
  return runtimes.find((runtime) => runtime.id === configuredId) ?? null;
}

function latestRuntimeActionLabel(missing: boolean): string {
  return missing ? "Install latest" : "Update to latest";
}

function runtimeIdForFamily(
  family: string,
  selectedRuntime: string,
  runtimes: BrainRuntime[],
): string {
  if (family === "auto") return "auto";
  return selectedRuntime === "auto" ? (runtimes[0]?.id ?? "auto") : selectedRuntime;
}

function selectedRuntimeInstallState(answered: boolean, activeRuntime: BrainRuntime | null) {
  return {
    installed: answered && activeRuntime !== null,
    missing: answered && activeRuntime === null,
  };
}

// Runtime

/**
 * Three states, not two: unknown, absent, installed.
 *
 * An empty runtime list is only evidence of absence once the host has actually
 * answered. Before that - the daemon is down, the socket is still coming up -
 * `runtimes` is `[]` for want of an answer, and treating that as "not installed"
 * puts an Install call to action in front of a runtime that may well be there.
 * A stopped daemon read exactly like a missing llama.cpp.
 */
interface RuntimeManagerProps {
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
  /** The selected Brain host's live runtime identity, when it has one. */
  hostRuntime?: string | null;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
}

export function RuntimeManagerSheet(props: RuntimeManagerProps) {
  const view = useRuntimeManager(props);
  return <RuntimeManagerView view={view} />;
}

function useRuntimeManager({
  visible,
  onClose,
  runtimes,
  answered,
  loading,
  busy,
  canInstall = true,
  hostRuntime = null,
  jobs,
  onStarted,
}: RuntimeManagerProps) {
  const styles = useStyles();
  const reportError = useReportBrainError();
  const client = useBrainOperations();
  const preferences = useBrainPreferences();
  const host = useBrainHost();
  const isRemoteBrain = host.mode === "remote";
  const [build, setBuild] = useState("");
  const buildInputRef = useRef<EditingTextInputHandle>(null);
  const [showSpecificBuild, setShowSpecificBuild] = useState(false);
  const selectedRuntime = preferences.runtimeSelectionId ?? "auto";
  const activeRuntime = useMemo(
    () =>
      isRemoteBrain
        ? resolveHostSelectedBrainRuntime(runtimes, hostRuntime)
        : resolveSelectedBrainRuntime(
            runtimes,
            selectedRuntime === "auto" ? null : selectedRuntime,
          ),
    [hostRuntime, isRemoteBrain, runtimes, selectedRuntime],
  );
  const hostHasRuntime = Boolean(hostRuntime?.trim());
  const { installed, missing } = isRemoteBrain
    ? { installed: answered && hostHasRuntime, missing: answered && !hostHasRuntime }
    : selectedRuntimeInstallState(answered, activeRuntime);
  const job = useMemo(() => jobs.find((j) => j.kind === "runtime-install"), [jobs]);
  const installedBuildOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      runtimes.map((runtime) => ({
        id: runtime.id,
        value: runtime.id,
        label: formatBrainRuntime(runtime),
      })),
    [runtimes],
  );
  const handleRuntimeSelect = useCallback(
    (path: string) => {
      void client
        .selectRuntime(path === "auto" ? null : path)
        .catch((error) => reportError("Could not select runtime", error));
    },
    [client, reportError],
  );
  const removableRuntimes = useMemo(
    () =>
      runtimes.filter(
        (runtime) => runtime.source === "managed" && runtime.id !== activeRuntime?.id,
      ),
    [activeRuntime?.id, runtimes],
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
        const started = await client.removeRuntime(selectedRemovalRuntime.id);
        setRemovalJobId(started.id);
        onStarted(started);
      } catch (error) {
        setRemovalError(describeRuntimeRemovalError(error));
        setRemovalNeedsElevation(isRuntimeRemovalAccessDenied(error));
      }
    })();
  }, [client, onStarted, selectedRemovalRuntime]);
  const canElevateRemoval = host.access.canElevateRuntimeRemoval;
  const handleElevatedRuntimeRemoval = useCallback(() => {
    if (!selectedRemovalRuntime) return;
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
        await client.removeRuntimeElevated(selectedRemovalRuntime.id);
        setRemoveName("");
        setRemovalError(null);
        setRemovalNeedsElevation(false);
        await client.refresh(["runtimes"]);
      } catch (error) {
        setRemovalError(describeRuntimeRemovalError(error));
      } finally {
        setElevatingRemoval(false);
      }
    })();
  }, [client, selectedRemovalRuntime]);
  const handleInstall = useCallback(
    (requestedBuild: string | null = null) => {
      if (!client) return;
      void client
        .installRuntime(requestedBuild)
        .then(onStarted)
        .catch((error) => reportError("Unable to install the runtime", error));
    },
    [client, onStarted, reportError],
  );
  const handleLatestInstall = useCallback(() => handleInstall("latest"), [handleInstall]);
  const handleBuildInstall = useCallback(
    () => handleInstall((buildInputRef.current?.getText() ?? build).trim() || "latest"),
    [build, handleInstall],
  );
  const handleRuntimeFamilyChange = useCallback(
    (value: string) => handleRuntimeSelect(runtimeIdForFamily(value, selectedRuntime, runtimes)),
    [handleRuntimeSelect, runtimes, selectedRuntime],
  );
  const handleShowSpecificBuild = useCallback(() => setShowSpecificBuild(true), []);

  const detail = useMemo(
    () =>
      isRemoteBrain && hostHasRuntime
        ? (hostRuntime?.trim() ?? "")
        : describeRuntimeState({ activeRuntime, answered, loading }),
    [activeRuntime, answered, hostHasRuntime, hostRuntime, isRemoteBrain, loading],
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
  const handleRemovalSelect = useCallback((value: string) => {
    setRemoveName(value);
    setRemovalError(null);
    setRemovalNeedsElevation(false);
  }, []);

  return {
    styles,
    visible,
    onClose,
    isRemoteBrain,
    runtimeFamilyValue,
    runtimeFamilyOptions,
    handleRuntimeFamilyChange,
    runtimeFamilyDisplay,
    detail,
    installed,
    canInstall,
    missing,
    handleLatestInstall,
    client,
    busy,
    latestActionLabel,
    job,
    showSpecificBuild,
    handleShowSpecificBuild,
    build,
    buildInputRef,
    setBuild,
    handleBuildInstall,
    installedBuildOptions,
    selectedRuntime,
    handleRuntimeSelect,
    installedBuildDisplay,
    removableRuntimes,
    removeName,
    removableRuntimeOptions,
    handleRemovalSelect,
    removableBuildDisplay,
    handleRemoveRuntime,
    selectedRemovalRuntime,
    removalBlockingJob,
    elevatingRemoval,
    removalError,
    removalNeedsElevation,
    canElevateRemoval,
    handleElevatedRuntimeRemoval,
  };
}

type RuntimeManagerViewState = ReturnType<typeof useRuntimeManager>;

function RuntimeManagerView({ view }: { view: RuntimeManagerViewState }) {
  const {
    styles,
    visible,
    onClose,
    isRemoteBrain,
    runtimeFamilyValue,
    runtimeFamilyOptions,
    handleRuntimeFamilyChange,
    runtimeFamilyDisplay,
    detail,
    installed,
    canInstall,
    missing,
    handleLatestInstall,
    client,
    busy,
    latestActionLabel,
    job,
  } = view;
  return (
    <AdaptiveModalSheet
      header={runtimeManagerHeader}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={560}
      testID="brain-runtime-manager"
    >
      {isRemoteBrain ? (
        <View style={styles.managerSection}>
          <Text style={styles.managerLabel}>Remote runtime</Text>
          <Text style={styles.managerHint}>
            This is the runtime selected on the Brain host. Installing a build updates that host; it
            never changes the connecting daemon’s local runtime.
          </Text>
        </View>
      ) : (
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
      )}

      <View style={styles.managerSection}>
        <Text style={styles.managerLabel}>llama.cpp</Text>
        <View style={settingsStyles.card}>
          <View style={styles.rowResponsive}>
            <View style={styles.rowContent}>
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
            <View style={[styles.rowResponsive, settingsStyles.rowBorder]}>
              <View style={styles.rowContent}>
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

      <SpecificRuntimeBuilds view={view} />
    </AdaptiveModalSheet>
  );
}

function SpecificRuntimeBuilds({ view }: { view: RuntimeManagerViewState }) {
  const {
    styles,
    isRemoteBrain,
    canInstall,
    client,
    busy,
    showSpecificBuild,
    handleShowSpecificBuild,
    build,
    buildInputRef,
    setBuild,
    handleBuildInstall,
    installedBuildOptions,
    selectedRuntime,
    handleRuntimeSelect,
    installedBuildDisplay,
  } = view;
  if (!canInstall) return null;
  return (
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
              ref={buildInputRef}
              initialValue={build}
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
          {!isRemoteBrain && installedBuildOptions.length > 0 ? (
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
          <RuntimeRemoval view={view} />
        </>
      )}
    </View>
  );
}

function RuntimeRemoval({ view }: { view: RuntimeManagerViewState }) {
  const {
    styles,
    client,
    removableRuntimes,
    removeName,
    removableRuntimeOptions,
    handleRemovalSelect,
    removableBuildDisplay,
    handleRemoveRuntime,
    selectedRemovalRuntime,
    removalBlockingJob,
    elevatingRemoval,
    removalError,
    removalNeedsElevation,
    canElevateRemoval,
    handleElevatedRuntimeRemoval,
  } = view;
  if (removableRuntimes.length === 0) return null;
  return (
    <>
      <View style={styles.specificBuildRow}>
        <SelectField
          field={false}
          label="Remove an installed build"
          size="sm"
          value={removeName}
          options={removableRuntimeOptions}
          onChange={handleRemovalSelect}
          selectedDisplay={removableBuildDisplay}
          placeholder="Choose a build to remove"
          emptyText="No removable builds are available."
        />
        <Button
          variant="outline"
          size="sm"
          onPress={handleRemoveRuntime}
          disabled={
            !client || !selectedRemovalRuntime || removalBlockingJob !== null || elevatingRemoval
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
  );
}

// Installed models

// Catalog (downloadable)
