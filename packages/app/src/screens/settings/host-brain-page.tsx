import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type {
  BrainHostStatus,
  BrainTailscaleInfo,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
} from "@otto-code/protocol/messages";
import {
  Activity,
  Copy,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Waypoints,
} from "@/components/icons/material-icons";
import { BrainDashboardSheet } from "@/components/brain-dashboard-sheet";
import { BrainModelsSection, BrainOperationsSection } from "@/screens/settings/host-brain-models";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

type BrainConfig = MutableDaemonConfig["brain"];
type BrainConfigPatch = NonNullable<MutableDaemonConfigPatch["brain"]>;
type TlsMode = BrainConfig["tls"]["mode"];
type BrainMode = BrainConfig["mode"];
type BrainAction = "start" | "stop" | "restart";
type ShareAccess = "key" | "open";

const MODE_OPTIONS: { value: BrainMode; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "remote", label: "Remote" },
];

const ACCESS_OPTIONS: { value: ShareAccess; label: string }[] = [
  { value: "key", label: "Key" },
  { value: "open", label: "Open" },
];

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "";
}

// A fresh 64-hex access key from the polyfilled Web Crypto (see polyfills/crypto).
function generateAccessKey(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Themed leaf helpers (no useUnistyles: banned — see docs/unistyles.md)
// ---------------------------------------------------------------------------

const ThemedPlay = withUnistyles(Play);
const ThemedSquare = withUnistyles(Square);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedActivity = withUnistyles(Activity);
const ThemedWaypoints = withUnistyles(Waypoints);
const ThemedCopy = withUnistyles(Copy);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const foregroundIconMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});

const startIcon = <ThemedPlay uniProps={foregroundIconMapping} />;
const stopIcon = <ThemedSquare uniProps={foregroundIconMapping} />;
const restartIcon = <ThemedRotateCw uniProps={foregroundIconMapping} />;
const dashboardIcon = <ThemedActivity uniProps={foregroundIconMapping} />;
const discoverIcon = <ThemedWaypoints uniProps={foregroundIconMapping} />;
const copyIcon = <ThemedCopy uniProps={foregroundIconMapping} />;
const generateIcon = <ThemedRefreshCw uniProps={foregroundIconMapping} />;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function brainStatusQueryKey(serverId: string): readonly [string, string] {
  return ["brain-host-status", serverId] as const;
}

function formatEndpoint(status: BrainHostStatus): string | null {
  const host = status.displayHost ?? status.host;
  if (!host || !status.port) {
    return null;
  }
  const scheme = status.secure ? "https" : "http";
  return `${scheme}://${host}:${status.port}`;
}

function formatVram(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

// ---------------------------------------------------------------------------
// Status section
// ---------------------------------------------------------------------------

function useBrainHostStatusQuery(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: brainStatusQueryKey(serverId),
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: 5000,
    refetchInterval: 5000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Brain host is unavailable");
      }
      return client.brainHostStatus();
    },
  });
}

function StatusDetailRow({
  title,
  value,
  showBorder,
}: {
  title: string;
  value: string;
  showBorder: boolean;
}) {
  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function BrainStatusSection({ serverId, isConnected }: { serverId: string; isConnected: boolean }) {
  const { config } = useDaemonConfig(serverId);
  const isRemote = config?.brain.mode === "remote";
  const statusSupported = useHostFeature(serverId, "brainStatus");
  const query = useBrainHostStatusQuery(serverId, isConnected && statusSupported);

  const status = query.data ?? null;
  const running = status?.running === true;

  const detailRows = useMemo(() => {
    if (!status) return [];
    const rows: { title: string; value: string }[] = [];
    if (status.state) rows.push({ title: "State", value: status.state });
    if (status.version) rows.push({ title: "Version", value: status.version });
    if (status.model ?? status.modelId)
      rows.push({ title: "Model", value: status.model ?? status.modelId ?? "" });
    const endpoint = formatEndpoint(status);
    if (endpoint) rows.push({ title: "Endpoint", value: endpoint });
    const vram = formatVram(status.vramBytes);
    if (vram) rows.push({ title: "VRAM", value: vram });
    return rows;
  }, [status]);

  return (
    <SettingsSection title="Status">
      <View style={settingsStyles.card} testID="host-brain-status-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Host</Text>
            <Text style={settingsStyles.rowHint}>
              {isRemote
                ? "Whether the remote brain is reachable."
                : "Whether the brain is currently running on this host."}
            </Text>
          </View>
          <View style={running ? STATUS_PILL_RUNNING_STYLE : STATUS_PILL_STOPPED_STYLE}>
            <View style={running ? styles.statusDotRunning : styles.statusDotStopped} />
            <Text style={running ? styles.statusTextRunning : styles.statusTextStopped}>
              {running ? "Running" : "Stopped"}
            </Text>
          </View>
        </View>

        {detailRows.map((row) => (
          <StatusDetailRow key={row.title} title={row.title} value={row.value} showBorder />
        ))}

        {status?.lastError ? (
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Last error</Text>
              <Text style={styles.errorText}>{status.lastError}</Text>
            </View>
          </View>
        ) : null}

        <BrainDashboardLauncher serverId={serverId} supported={statusSupported} />

        {isRemote ? null : (
          <BrainLifecycleControls serverId={serverId} isConnected={isConnected} running={running} />
        )}
      </View>
    </SettingsSection>
  );
}

// Model override + start/stop/restart for the local managed brain. Owns the
// action state so BrainStatusSection stays a display; hidden entirely in remote
// mode, where lifecycle is the remote host's to manage.
function BrainLifecycleControls({
  serverId,
  isConnected,
  running,
}: {
  serverId: string;
  isConnected: boolean;
  running: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<BrainAction | null>(null);
  const [modelDraft, setModelDraft] = useState("");

  const runAction = useCallback(
    (action: BrainAction) => {
      if (!client) {
        return;
      }
      const activeClient = client;
      setPending(action);
      const model = modelDraft.trim().length > 0 ? modelDraft.trim() : null;
      void (async () => {
        try {
          let next: BrainHostStatus;
          if (action === "start") {
            next = await activeClient.brainHostStart(model);
          } else if (action === "restart") {
            next = await activeClient.brainHostRestart(model);
          } else {
            next = await activeClient.brainHostStop();
          }
          queryClient.setQueryData(brainStatusQueryKey(serverId), next);
        } catch (error) {
          console.error(`[HostBrainPage] Failed to ${action} brain`, error);
          Alert.alert(
            "Unable to update the brain",
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setPending(null);
        }
      })();
    },
    [client, modelDraft, queryClient, serverId],
  );

  const handleStart = useCallback(() => runAction("start"), [runAction]);
  const handleStop = useCallback(() => {
    void confirmDialog({
      title: "Stop the brain?",
      message: "Any loaded model is unloaded and requests stop until you start it again.",
      confirmLabel: "Stop",
      cancelLabel: "Cancel",
      destructive: true,
    })
      .then((confirmed) => {
        if (confirmed) runAction("stop");
        return;
      })
      .catch(() => undefined);
  }, [runAction]);
  const handleRestart = useCallback(() => {
    void confirmDialog({
      title: "Restart the brain?",
      message: "The host stops and starts again, reloading the model.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    })
      .then((confirmed) => {
        if (confirmed) runAction("restart");
        return;
      })
      .catch(() => undefined);
  }, [runAction]);

  const actionsDisabled = !client || !isConnected || pending !== null;
  const handleModelOverride = useCallback((next: string | null) => setModelDraft(next ?? ""), []);

  return (
    <>
      <ModelPickerRow
        serverId={serverId}
        title="Model override"
        hint="Pick a model to load on start/restart, or Automatic to use the default."
        value={modelDraft.length > 0 ? modelDraft : null}
        onChange={handleModelOverride}
        includeAutomatic
        showBorder
        triggerTestID="host-brain-model-override-picker"
      />

      <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Lifecycle</Text>
          <Text style={settingsStyles.rowHint}>Start, stop, or restart the brain host.</Text>
        </View>
        <View style={ACTIONS_GROUP_STYLE}>
          <Button
            variant="default"
            size="sm"
            leftIcon={startIcon}
            onPress={handleStart}
            disabled={actionsDisabled || running}
            testID="host-brain-start-button"
          >
            {pending === "start" ? "Starting..." : "Start"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={stopIcon}
            onPress={handleStop}
            disabled={actionsDisabled || !running}
            testID="host-brain-stop-button"
          >
            {pending === "stop" ? "Stopping..." : "Stop"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={restartIcon}
            onPress={handleRestart}
            disabled={actionsDisabled || !running}
            testID="host-brain-restart-button"
          >
            {pending === "restart" ? "Restarting..." : "Restart"}
          </Button>
        </View>
      </View>
    </>
  );
}

// Owns the dashboard sheet's open state so BrainStatusSection stays simple. The
// row opens the live-status & evals dashboard; the sheet renders alongside it.
function BrainDashboardLauncher({ serverId, supported }: { serverId: string; supported: boolean }) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  if (!supported) {
    return null;
  }
  return (
    <>
      <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Dashboard</Text>
          <Text style={settingsStyles.rowHint}>
            Watch live status, telemetry, and benchmark rankings.
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={dashboardIcon}
          onPress={handleOpen}
          testID="host-brain-open-dashboard-button"
        >
          Open dashboard
        </Button>
      </View>
      <BrainDashboardSheet serverId={serverId} visible={open} onClose={handleClose} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Config section
// ---------------------------------------------------------------------------

function BrainTextRow({
  title,
  hint,
  value,
  placeholder,
  showBorder,
  secure,
  numeric,
  onCommit,
  testID,
}: {
  title: string;
  hint?: string;
  value: string;
  placeholder?: string;
  showBorder: boolean;
  secure?: boolean;
  numeric?: boolean;
  onCommit: (next: string) => void;
  testID?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    if (draft !== value) {
      onCommit(draft);
    }
  }, [draft, onCommit, value]);

  const rowStyle = useMemo(
    () => [settingsStyles.rowResponsive, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <ThemedTextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={placeholder}
        secureTextEntry={secure}
        keyboardType={numeric ? "number-pad" : "default"}
        inputMode={numeric ? "numeric" : "text"}
        style={styles.textInputWide}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={title}
        testID={testID}
      />
    </View>
  );
}

// Detected model names for the pickers. Populated only while the brain is
// reachable (local child up, or remote); empty otherwise, which disables the
// picker rather than falling back to a text box.
function useBrainModels(serverId: string): string[] {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "brainStatus");
  const query = useFetchQuery({
    queryKey: ["brain-models", serverId] as const,
    enabled: supported && isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Brain host is unavailable");
      }
      return client.brainModelsList();
    },
  });
  return query.data ?? [];
}

// null models sort under one stable key so the "Automatic" option round-trips.
const modelValueKey = (value: string | null): string => value ?? "__automatic__";

// A model chooser, never a text box: options are the detected models, disabled
// (with a "start the brain" prompt) when none are detected. `includeAutomatic`
// adds a null "Automatic" choice for fields that may be left unset.
function ModelPickerRow({
  serverId,
  title,
  hint,
  value,
  onChange,
  includeAutomatic,
  showBorder,
  triggerTestID,
}: {
  serverId: string;
  title: string;
  hint: string;
  value: string | null;
  onChange: (next: string | null) => void;
  includeAutomatic: boolean;
  showBorder: boolean;
  triggerTestID?: string;
}) {
  const models = useBrainModels(serverId);
  const options = useMemo<SelectFieldOption<string | null>[]>(() => {
    const opts: SelectFieldOption<string | null>[] = includeAutomatic
      ? [{ id: "__automatic__", value: null, label: "Automatic" }]
      : [];
    for (const name of models) {
      opts.push({ id: name, value: name, label: name });
    }
    return opts;
  }, [models, includeAutomatic]);

  const disabled = models.length === 0;
  const selectedDisplay = useMemo<{ label: string } | null>(() => {
    if (value) return { label: value };
    if (includeAutomatic) return { label: "Automatic" };
    return null;
  }, [value, includeAutomatic]);
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
      <SelectField<string | null>
        field={false}
        size="sm"
        label={title}
        value={value}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={onChange}
        placeholder={disabled ? "Start the brain to list models" : "Select a model"}
        emptyText="No models detected"
        disabled={disabled}
        searchable
        getValueKey={modelValueKey}
        triggerStyle={styles.pickerTrigger}
        triggerTestID={triggerTestID}
      />
    </View>
  );
}

const TLS_MODE_OPTIONS: { value: TlsMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "files", label: "Files" },
  { value: "self-signed", label: "Self-signed" },
  { value: "tailscale", label: "Tailscale" },
];

// Auto-detect this host's Tailscale identity so the operator doesn't have to
// hunt for the MagicDNS name and cert directory by hand. Gated by the daemon
// capability; hidden on hosts that can't answer the probe.
function TailscaleDiscoverRow({
  serverId,
  onDiscovered,
}: {
  serverId: string;
  onDiscovered: (info: BrainTailscaleInfo) => void;
}) {
  const supported = useHostFeature(serverId, "brainNetworkDiscovery");
  const client = useHostRuntimeClient(serverId);
  const [pending, setPending] = useState(false);

  const handleDetect = useCallback(() => {
    if (!client) {
      return;
    }
    const activeClient = client;
    setPending(true);
    void (async () => {
      try {
        const net = await activeClient.brainNetworkDiscover();
        const info = net?.tailscale ?? null;
        if (!info || !info.available) {
          Alert.alert(
            "Tailscale not detected",
            "Install Tailscale and sign in on the host, then try detecting again.",
          );
          return;
        }
        onDiscovered(info);
        Alert.alert(
          "Tailscale detected",
          info.hostname
            ? `Filled in ${info.hostname} and the certificate directory.`
            : "Filled in the available Tailscale settings.",
        );
      } catch (error) {
        Alert.alert(
          "Unable to detect Tailscale",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setPending(false);
      }
    })();
  }, [client, onDiscovered]);

  if (!supported) {
    return null;
  }

  return (
    <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Auto-detect</Text>
        <Text style={settingsStyles.rowHint}>
          Discover this host&apos;s Tailscale name and certificate directory for you.
        </Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        leftIcon={discoverIcon}
        onPress={handleDetect}
        disabled={pending || !client}
        testID="host-brain-tls-discover-button"
      >
        {pending ? "Detecting..." : "Detect"}
      </Button>
    </View>
  );
}

// The "Server" section: the whole server definition in one group — mode, the two
// independent lifecycle switches, and (local) how it binds and which model it
// serves, or (remote) where to reach it. Authentication and Security follow in
// their own sections below Status.
function BrainServerSection({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const remoteSupported = useHostFeature(serverId, "brainRemote");
  const brain = config?.brain ?? null;

  const patchBrain = useCallback(
    (patch: BrainConfigPatch) => {
      void patchConfig({ brain: patch }).catch((error) => {
        console.error("[HostBrainPage] Failed to update brain config", error);
        Alert.alert(
          "Unable to update the brain",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );
  const patchListen = useCallback(
    (next: Partial<BrainConfig["listen"]>) => {
      if (!brain) return;
      patchBrain({ listen: { ...brain.listen, ...next } });
    },
    [brain, patchBrain],
  );
  const patchRemote = useCallback(
    (next: Partial<BrainConfig["remote"]>) => {
      if (!brain) return;
      patchBrain({ remote: { ...brain.remote, ...next } });
    },
    [brain, patchBrain],
  );

  // Optimistic so a controlled Switch backed by a slow, full-config round-trip
  // doesn't visibly bounce. The two switches are fully independent.
  const enabled = useOptimisticFlag(brain?.enabled ?? false);
  const autoStart = useOptimisticFlag(brain?.autoStart ?? false);
  const lockModel = useOptimisticFlag(brain?.lockModel ?? false);

  const handleMode = useCallback((mode: BrainMode) => patchBrain({ mode }), [patchBrain]);
  const handleEnabled = useCallback(
    (next: boolean) => {
      enabled.set(next);
      patchBrain({ enabled: next });
    },
    [enabled, patchBrain],
  );
  const handleAutoStart = useCallback(
    (next: boolean) => {
      autoStart.set(next);
      patchBrain({ autoStart: next });
    },
    [autoStart, patchBrain],
  );
  const handleLockModel = useCallback(
    (next: boolean) => {
      lockModel.set(next);
      patchBrain({ lockModel: next });
    },
    [lockModel, patchBrain],
  );
  const handlePort = useCallback(
    (raw: string) => {
      const port = Number.parseInt(raw, 10);
      if (Number.isFinite(port) && port > 0) patchListen({ port });
    },
    [patchListen],
  );
  const handleDefaultModel = useCallback(
    (next: string | null) => patchBrain({ defaultModel: next }),
    [patchBrain],
  );
  const handleRemoteHost = useCallback((host: string) => patchRemote({ host }), [patchRemote]);
  const handleRemotePort = useCallback(
    (raw: string) => {
      const port = Number.parseInt(raw, 10);
      if (Number.isFinite(port) && port > 0) patchRemote({ port });
    },
    [patchRemote],
  );
  const handleRemoteSecure = useCallback(
    (secure: boolean) => patchRemote({ secure }),
    [patchRemote],
  );
  const handleRemoteToken = useCallback(
    (raw: string) => patchRemote({ authToken: raw.trim().length > 0 ? raw.trim() : null }),
    [patchRemote],
  );

  if (!brain) {
    return null;
  }

  const isRemote = brain.mode === "remote";

  return (
    <SettingsSection title="Server">
      <View style={settingsStyles.card} testID="host-brain-server-card">
        {remoteSupported ? (
          <View style={settingsStyles.rowResponsive}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Mode</Text>
              <Text style={settingsStyles.rowHint}>
                Run the brain on this host, or connect to one running on another Otto host.
              </Text>
            </View>
            <SegmentedControl
              size="sm"
              value={brain.mode}
              onValueChange={handleMode}
              options={MODE_OPTIONS}
              testID="host-brain-mode"
            />
          </View>
        ) : null}

        <View style={remoteSupported ? ROW_WITH_BORDER_STYLE : settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Enable</Text>
            <Text style={settingsStyles.rowHint}>
              {isRemote
                ? "Connect this host to a brain running on another Otto host. Its status, benchmarks, and models appear here."
                : "Let this host serve your local models to every provider."}
            </Text>
          </View>
          <Switch
            value={enabled.value}
            onValueChange={handleEnabled}
            accessibilityLabel="Enable brain"
            testID="host-brain-enabled-switch"
          />
        </View>

        {isRemote ? (
          <>
            <BrainTextRow
              title="Host"
              hint="Hostname or IP of the Otto host running the brain."
              value={brain.remote.host}
              placeholder="brain.example.ts.net"
              showBorder
              onCommit={handleRemoteHost}
              testID="host-brain-remote-host-input"
            />
            <BrainTextRow
              title="Port"
              value={String(brain.remote.port)}
              placeholder="1234"
              showBorder
              numeric
              onCommit={handleRemotePort}
              testID="host-brain-remote-port-input"
            />
            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Use HTTPS</Text>
                <Text style={settingsStyles.rowHint}>
                  Connect over TLS. Turn on if the remote brain serves HTTPS.
                </Text>
              </View>
              <Switch
                value={brain.remote.secure}
                onValueChange={handleRemoteSecure}
                accessibilityLabel="Use HTTPS for the remote brain"
                testID="host-brain-remote-secure-switch"
              />
            </View>
            <BrainTextRow
              title="Auth token"
              hint="Bearer token the remote brain requires, if any."
              value={brain.remote.authToken ?? ""}
              placeholder="Secret token"
              showBorder
              secure
              onCommit={handleRemoteToken}
              testID="host-brain-remote-token-input"
            />
          </>
        ) : (
          <>
            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Start automatically</Text>
                <Text style={settingsStyles.rowHint}>
                  Start the brain when the host daemon starts.
                </Text>
              </View>
              <Switch
                value={autoStart.value}
                onValueChange={handleAutoStart}
                accessibilityLabel="Start brain automatically"
                testID="host-brain-auto-start-switch"
              />
            </View>
            <BrainTextRow
              title="Listen port"
              hint="The port the brain serves on."
              value={String(brain.listen.port)}
              placeholder="1234"
              showBorder
              numeric
              onCommit={handlePort}
              testID="host-brain-listen-port-input"
            />
            <ModelPickerRow
              serverId={serverId}
              title="Default model"
              hint="Loaded on start. Automatic serves the best-ranked model that fits."
              value={brain.defaultModel}
              onChange={handleDefaultModel}
              includeAutomatic
              showBorder
              triggerTestID="host-brain-default-model-picker"
            />
            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Lock model</Text>
                <Text style={settingsStyles.rowHint}>
                  Serve only this model. Requests for a different model are refused instead of
                  switching, so many clients share one loaded model without thrashing.
                </Text>
              </View>
              <Switch
                value={lockModel.value}
                onValueChange={handleLockModel}
                accessibilityLabel="Lock model"
                testID="host-brain-lock-model-switch"
              />
            </View>
          </>
        )}
      </View>
    </SettingsSection>
  );
}

// A boolean that shows the user's just-clicked value immediately and defers to
// the server value once it agrees — so a controlled Switch backed by a slow,
// non-optimistic round-trip doesn't visibly bounce back mid-flight.
function useOptimisticFlag(serverValue: boolean): { value: boolean; set: (next: boolean) => void } {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    setPending((current) => (current === serverValue ? null : current));
  }, [serverValue]);
  return { value: pending ?? serverValue, set: setPending };
}

const CUSTOM_BIND = "__custom__";

// Picker for `listen.host`: nobody wants to hand-type an interface IP, so we
// offer the choices they actually mean — Local only, All interfaces, each
// detected LAN address, and Tailscale — with a Custom escape hatch. Local-only
// and All are static so the picker works even on a daemon that can't run the
// discovery probe; detection just enriches the list.
function HostBindPicker({
  serverId,
  value,
  onChange,
}: {
  serverId: string;
  value: string;
  onChange: (host: string) => void;
}) {
  const supported = useHostFeature(serverId, "brainNetworkDiscovery");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useFetchQuery({
    queryKey: ["brain-network-discover", serverId] as const,
    enabled: supported && isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: 30_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Brain host is unavailable");
      }
      return client.brainNetworkDiscover();
    },
  });

  const options = useMemo(() => {
    const seen = new Set<string>();
    const merged: { value: string; label: string }[] = [];
    const add = (optionValue: string, label: string) => {
      if (!seen.has(optionValue)) {
        seen.add(optionValue);
        merged.push({ value: optionValue, label });
      }
    };
    add("127.0.0.1", "Local only");
    add("0.0.0.0", "All interfaces");
    for (const address of query.data?.addresses ?? []) {
      add(address.value, address.label);
    }
    return merged;
  }, [query.data]);

  const known = options.some((option) => option.value === value);
  const [customMode, setCustomMode] = useState(!known && value.length > 0);
  const selected = customMode || !known ? CUSTOM_BIND : value;

  const segmentOptions = useMemo(
    () => [...options, { value: CUSTOM_BIND, label: "Custom" }],
    [options],
  );

  const handleSelect = useCallback(
    (next: string) => {
      if (next === CUSTOM_BIND) {
        setCustomMode(true);
        return;
      }
      setCustomMode(false);
      onChange(next);
    },
    [onChange],
  );

  return (
    <>
      <View style={settingsStyles.rowResponsive}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Listen host</Text>
          <Text style={settingsStyles.rowHint}>
            Which network the brain accepts connections on. Local only keeps it on this machine; a
            specific address or All interfaces exposes it to your network.
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          wrap
          value={selected}
          onValueChange={handleSelect}
          options={segmentOptions}
          testID="host-brain-listen-host-picker"
        />
      </View>
      {selected === CUSTOM_BIND ? (
        <BrainTextRow
          title="Custom host"
          hint="Interface or IP address to bind to."
          value={value}
          placeholder="127.0.0.1"
          showBorder
          onCommit={onChange}
          testID="host-brain-listen-host-input"
        />
      ) : null}
    </>
  );
}

function BrainConfigSection({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const brain = config?.brain ?? null;

  const patchBrain = useCallback(
    (patch: BrainConfigPatch) => {
      void patchConfig({ brain: patch }).catch((error) => {
        console.error("[HostBrainPage] Failed to update brain config", error);
        Alert.alert(
          "Unable to update the brain",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  // The patch schema resolves the `tls` block to its full shape, so it must be
  // sent whole. Merge the changed field over the current values.
  const patchTls = useCallback(
    (next: Partial<BrainConfig["tls"]>) => {
      if (!brain) return;
      patchBrain({ tls: { ...brain.tls, ...next } });
    },
    [brain, patchBrain],
  );
  const handleTlsMode = useCallback((mode: TlsMode) => patchTls({ mode }), [patchTls]);
  const handleCertFile = useCallback(
    (raw: string) => patchTls({ certFile: raw.trim().length > 0 ? raw.trim() : null }),
    [patchTls],
  );
  const handleKeyFile = useCallback(
    (raw: string) => patchTls({ keyFile: raw.trim().length > 0 ? raw.trim() : null }),
    [patchTls],
  );
  const handleHostname = useCallback(
    (raw: string) => patchTls({ hostname: raw.trim().length > 0 ? raw.trim() : null }),
    [patchTls],
  );
  const handleCertDir = useCallback(
    (raw: string) => patchTls({ certDir: raw.trim().length > 0 ? raw.trim() : null }),
    [patchTls],
  );
  const handleRenewBeforeDays = useCallback(
    (raw: string) => {
      const days = Number.parseInt(raw, 10);
      if (Number.isFinite(days) && days >= 0) {
        patchTls({ renewBeforeDays: days });
      }
    },
    [patchTls],
  );
  // Auto-discovery fills whatever Tailscale reports; keep any value it can't
  // supply. hostname is required for a cert, certDir is where it's written.
  const handleTailscaleDiscovered = useCallback(
    (info: BrainTailscaleInfo) => {
      const next: Partial<BrainConfig["tls"]> = {};
      if (info.hostname) next.hostname = info.hostname;
      if (info.certDir) next.certDir = info.certDir;
      if (Object.keys(next).length > 0) patchTls(next);
    },
    [patchTls],
  );

  if (!brain) {
    return (
      <SettingsSection title="Configuration">
        <View style={LOADING_CARD_STYLE}>
          <ActivityIndicator size="small" />
        </View>
      </SettingsSection>
    );
  }

  // Security (HTTPS) describes the local server; a remote brain's own host owns
  // it, so this renders nothing in remote mode. (Access/keys live in Sharing.)
  if (brain.mode === "remote") {
    return null;
  }

  const tlsMode = brain.tls.mode;

  return (
    <SettingsSection title="Security (HTTPS)">
      <View style={settingsStyles.card} testID="host-brain-tls-card">
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>HTTPS</Text>
            <Text style={settingsStyles.rowHint}>
              Off serves plain HTTP on the port above. Turn it on to serve HTTPS on that same port,
              using certificate files, a self-signed certificate, or a Tailscale certificate.
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            wrap
            value={tlsMode}
            onValueChange={handleTlsMode}
            options={TLS_MODE_OPTIONS}
            testID="host-brain-tls-mode"
          />
        </View>
        {tlsMode === "files" ? (
          <>
            <BrainTextRow
              title="Certificate file"
              value={brain.tls.certFile ?? ""}
              placeholder="/path/to/cert.pem"
              showBorder
              onCommit={handleCertFile}
              testID="host-brain-tls-cert-file-input"
            />
            <BrainTextRow
              title="Key file"
              value={brain.tls.keyFile ?? ""}
              placeholder="/path/to/key.pem"
              showBorder
              onCommit={handleKeyFile}
              testID="host-brain-tls-key-file-input"
            />
          </>
        ) : null}
        {tlsMode === "tailscale" ? (
          <TailscaleDiscoverRow serverId={serverId} onDiscovered={handleTailscaleDiscovered} />
        ) : null}
        {tlsMode === "self-signed" || tlsMode === "tailscale" ? (
          <>
            <BrainTextRow
              title="Hostname"
              hint="Name the certificate is issued for."
              value={brain.tls.hostname ?? ""}
              placeholder="host.local"
              showBorder
              onCommit={handleHostname}
              testID="host-brain-tls-hostname-input"
            />
            <BrainTextRow
              title="Certificate directory"
              hint="Where generated certificates are stored."
              value={brain.tls.certDir ?? ""}
              placeholder="/path/to/certs"
              showBorder
              onCommit={handleCertDir}
              testID="host-brain-tls-cert-dir-input"
            />
            <BrainTextRow
              title="Renew before (days)"
              hint="Renew the certificate this many days before it expires."
              value={String(brain.tls.renewBeforeDays)}
              placeholder="30"
              showBorder
              numeric
              onCommit={handleRenewBeforeDays}
              testID="host-brain-tls-renew-input"
            />
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

// The Sharing section (local brains only): opt this brain into being reachable —
// and optionally reconfigurable — by other Otto hosts. Off by default (loopback).
function BrainSharingSection({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const brain = config?.brain ?? null;
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const patchBrain = useCallback(
    (patch: BrainConfigPatch) => {
      void patchConfig({ brain: patch }).catch((error) => {
        console.error("[HostBrainPage] Failed to update brain config", error);
        Alert.alert(
          "Unable to update the brain",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  const shared = useOptimisticFlag(brain ? !isLoopbackHost(brain.listen.host) : false);
  const allowConfig = useOptimisticFlag(brain?.allowRemoteConfig ?? false);

  const handleShare = useCallback(
    (on: boolean) => {
      if (!brain) return;
      shared.set(on);
      if (on) {
        // Secure by default: turning sharing on requires a key. Reuse an existing
        // one (sentinel round-trips and the daemon keeps the real value) or mint
        // a fresh key and show it once.
        const key = brain.authToken || generateAccessKey();
        if (!brain.authToken) setGeneratedKey(key);
        patchBrain({
          listen: { ...brain.listen, host: "0.0.0.0" },
          authMode: "token",
          authToken: key,
          allowInsecureBind: false,
        });
      } else {
        setGeneratedKey(null);
        patchBrain({
          listen: { ...brain.listen, host: "127.0.0.1" },
          authMode: "none",
          allowInsecureBind: false,
          allowRemoteConfig: false,
        });
      }
    },
    [brain, patchBrain, shared],
  );

  const handleHost = useCallback(
    (host: string) => {
      if (!brain) return;
      patchBrain({ listen: { ...brain.listen, host } });
    },
    [brain, patchBrain],
  );

  const handleAccess = useCallback(
    (access: ShareAccess) => {
      if (!brain) return;
      if (access === "open") {
        patchBrain({ authMode: "none", allowInsecureBind: true });
        return;
      }
      const key = brain.authToken || generateAccessKey();
      if (!brain.authToken) setGeneratedKey(key);
      patchBrain({ authMode: "token", authToken: key, allowInsecureBind: false });
    },
    [brain, patchBrain],
  );

  const handleGenerate = useCallback(() => {
    const key = generateAccessKey();
    setGeneratedKey(key);
    patchBrain({ authMode: "token", authToken: key, allowInsecureBind: false });
  }, [patchBrain]);

  const handleCopy = useCallback(() => {
    if (generatedKey) void Clipboard.setStringAsync(generatedKey);
  }, [generatedKey]);

  const handleAllowConfig = useCallback(
    (next: boolean) => {
      allowConfig.set(next);
      patchBrain({ allowRemoteConfig: next });
    },
    [allowConfig, patchBrain],
  );

  if (!brain || brain.mode === "remote") {
    return null;
  }

  const access: ShareAccess = brain.authMode === "token" ? "key" : "open";

  return (
    <SettingsSection title="Sharing">
      <View style={settingsStyles.card} testID="host-brain-sharing-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Share with other hosts</Text>
            <Text style={settingsStyles.rowHint}>
              Off keeps the brain on this machine only. On lets other Otto hosts reach it.
            </Text>
          </View>
          <Switch
            value={shared.value}
            onValueChange={handleShare}
            accessibilityLabel="Share the brain with other hosts"
            testID="host-brain-share-switch"
          />
        </View>

        {shared.value ? (
          <>
            <HostBindPicker serverId={serverId} value={brain.listen.host} onChange={handleHost} />
            <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Access</Text>
                <Text style={settingsStyles.rowHint}>
                  {access === "key"
                    ? "A key is required to connect."
                    : "Open on a trusted network: anyone who can reach it can use it."}
                </Text>
              </View>
              <SegmentedControl
                size="sm"
                value={access}
                onValueChange={handleAccess}
                options={ACCESS_OPTIONS}
                testID="host-brain-access-mode"
              />
            </View>

            {access === "key" ? (
              <>
                <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
                  <View style={settingsStyles.rowContent}>
                    <Text style={settingsStyles.rowTitle}>Access key</Text>
                    <Text style={settingsStyles.rowHint}>
                      {brain.authToken ? "A key is set." : "No key yet — generate one."}
                    </Text>
                  </View>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={generateIcon}
                    onPress={handleGenerate}
                    testID="host-brain-generate-key-button"
                  >
                    Generate
                  </Button>
                </View>
                {generatedKey ? (
                  <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
                    <View style={settingsStyles.rowContent}>
                      <Text style={styles.keyText} selectable>
                        {generatedKey}
                      </Text>
                      <Text style={settingsStyles.rowHint}>
                        Copy it now and paste it on the connecting host. It won&apos;t be shown
                        again.
                      </Text>
                    </View>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={copyIcon}
                      onPress={handleCopy}
                      testID="host-brain-copy-key-button"
                    >
                      Copy
                    </Button>
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Allow reconfigure</Text>
                <Text style={settingsStyles.rowHint}>
                  Let key holders change the model and lock over the network. Off means they can use
                  it but not reconfigure it.
                </Text>
              </View>
              <Switch
                value={allowConfig.value}
                onValueChange={handleAllowConfig}
                accessibilityLabel="Allow remote reconfiguration"
                testID="host-brain-allow-config-switch"
              />
            </View>
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

// Configure a *remote* brain over its own /__host/config: the model it serves
// and its switch-lock policy. Network/TLS/auth stay owned by the remote host, so
// they are not shown here. Renders only in remote mode with a reachable brain.
function BrainRemoteConfigSection({ serverId }: { serverId: string }) {
  const { config } = useDaemonConfig(serverId);
  const remoteSupported = useHostFeature(serverId, "brainRemote");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();

  const active =
    remoteSupported && config?.brain.mode === "remote" && config.brain.enabled === true;
  const queryKey = useMemo(() => ["brain-remote-config", serverId] as const, [serverId]);

  const query = useFetchQuery({
    queryKey,
    enabled: active && isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Brain host is unavailable");
      }
      return client.brainRemoteConfigGet();
    },
  });

  const remoteConfig = query.data ?? null;
  const defaultModel =
    typeof remoteConfig?.defaultModel === "string" ? remoteConfig.defaultModel : null;
  const lock = useOptimisticFlag(remoteConfig?.lockModel === true);

  const applyPatch = useCallback(
    (patch: Record<string, unknown>) => {
      if (!client) return;
      void client
        .brainRemoteConfigPatch(patch)
        .then((next) => {
          queryClient.setQueryData(queryKey, next ?? null);
          return;
        })
        .catch((error) => {
          Alert.alert(
            "Unable to update the remote brain",
            error instanceof Error ? error.message : String(error),
          );
        });
    },
    [client, queryClient, queryKey],
  );

  const handleDefaultModel = useCallback(
    (next: string | null) => applyPatch({ defaultModel: next }),
    [applyPatch],
  );
  const handleLockModel = useCallback(
    (next: boolean) => {
      lock.set(next);
      applyPatch({ lockModel: next });
    },
    [applyPatch, lock],
  );

  if (!active) {
    return null;
  }

  // The remote owner gates config over the network; when off we show status but
  // can't edit (a write would 403), so present it read-only instead.
  const canConfigure = remoteConfig?.allowRemoteConfig === true;

  const messageRow = (title: string, hint: string) => (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </View>
  );

  let body: ReactNode;
  if (!remoteConfig) {
    body = messageRow(
      "Not reachable",
      "Connect to the remote brain to read and change its configuration.",
    );
  } else if (!canConfigure) {
    body = messageRow(
      "Read-only",
      'This brain doesn’t allow configuration over the network. Its owner can turn on "Allow reconfigure" in the brain’s Sharing settings.',
    );
  } else {
    body = (
      <>
        <ModelPickerRow
          serverId={serverId}
          title="Default model"
          hint="The model the remote brain loads. Changing it switches the model now."
          value={defaultModel}
          onChange={handleDefaultModel}
          includeAutomatic
          showBorder={false}
          triggerTestID="host-brain-remote-default-model-picker"
        />
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Lock model</Text>
            <Text style={settingsStyles.rowHint}>
              Serve only this model; refuse requests for a different one.
            </Text>
          </View>
          <Switch
            value={lock.value}
            onValueChange={handleLockModel}
            accessibilityLabel="Lock the remote brain to one model"
            testID="host-brain-remote-lock-model-switch"
          />
        </View>
      </>
    );
  }

  return (
    <SettingsSection title="Remote configuration">
      <View style={settingsStyles.card} testID="host-brain-remote-config-card">
        {body}
      </View>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function HostBrainPage({ serverId }: { serverId: string }) {
  const supported = useHostFeature(serverId, "brainControl");
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!supported) {
    return (
      <View>
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>Update the host to manage the brain.</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <BrainServerSection serverId={serverId} />
      <BrainStatusSection serverId={serverId} isConnected={isConnected} />
      <BrainModelsSection serverId={serverId} />
      <BrainOperationsSection serverId={serverId} />
      <BrainSharingSection serverId={serverId} />
      <BrainRemoteConfigSection serverId={serverId} />
      <BrainConfigSection serverId={serverId} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  detailValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    textAlign: "right",
    marginLeft: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  statusPillRunning: {
    backgroundColor: "rgba(74, 222, 128, 0.1)",
  },
  statusPillStopped: {
    backgroundColor: "rgba(161, 161, 170, 0.1)",
  },
  statusDotRunning: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.green[400],
  },
  statusDotStopped: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusTextRunning: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.green[400],
  },
  statusTextStopped: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  actionsGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  pickerTrigger: {
    minWidth: 200,
  },
  keyText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  textInputWide: {
    minWidth: 180,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
const LOADING_CARD_STYLE = [settingsStyles.card, styles.loadingCard];
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];
const ROW_RESPONSIVE_WITH_BORDER_STYLE = [settingsStyles.rowResponsive, settingsStyles.rowBorder];
const STATUS_PILL_RUNNING_STYLE = [styles.statusPill, styles.statusPillRunning];
const STATUS_PILL_STOPPED_STYLE = [styles.statusPill, styles.statusPillStopped];
const ACTIONS_GROUP_STYLE = [styles.actionsGroup, settingsStyles.rowControlGroup];
