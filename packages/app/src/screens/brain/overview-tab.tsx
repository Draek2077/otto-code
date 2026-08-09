/**
 * The Overview tab: what the brain is doing right now.
 *
 * This is the TUI's header, status panel and VRAM panel, promoted out of the
 * settings dashboard sheet. It is the only tab that asks for live resource
 * telemetry, because that costs an `nvidia-smi` spawn on the brain and nothing
 * else renders the numbers.
 */
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import type { BrainHostStatus, BrainJob } from "@otto-code/protocol/messages";
import {
  Boxes,
  CheckCircle,
  Gauge,
  HardDrive,
  Info,
  Layers,
  Play,
  Psychology,
  Scissors,
  Send,
  Server,
  RotateCw,
  Square,
  Timeline,
  Zap,
} from "@/components/icons/material-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor, useIsExtraCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import {
  prependJob,
  RuntimeRow,
  useBrainJobs,
  useBrainRuntimes,
  useRefreshOnJobCompletion,
} from "@/screens/settings/host-brain-models";
import type { Theme } from "@/styles/theme";
import { brainStatusQueryKey, formatGiB, formatPercent, useBrainStatus } from "./use-brain-data";

const ThemedPlay = withUnistyles(Play);
const ThemedSquare = withUnistyles(Square);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const foregroundIcon = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});

const startIcon = <ThemedPlay uniProps={foregroundIcon} />;
const stopIcon = <ThemedSquare uniProps={foregroundIcon} />;
const restartIcon = <ThemedRotateCw uniProps={foregroundIcon} />;

// Icon-topped tiles, matching the Metrics page's tile language so the two
// resource pages read as one system instead of two different eras of the UI.
const ThemedGauge = withUnistyles(Gauge);
const ThemedLayers = withUnistyles(Layers);
const ThemedZap = withUnistyles(Zap);
const ThemedBoxes = withUnistyles(Boxes);
const ThemedSend = withUnistyles(Send);
const ThemedCheckCircle = withUnistyles(CheckCircle);
const ThemedPsychology = withUnistyles(Psychology);
const ThemedScissors = withUnistyles(Scissors);
const ThemedInfo = withUnistyles(Info);
const ThemedServer = withUnistyles(Server);
const ThemedTimeline = withUnistyles(Timeline);
const ThemedHardDrive = withUnistyles(HardDrive);

const tileIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type Phase = "running" | "starting" | "stopped" | "failed";

/**
 * Four states, not two. The daemon reports `state: "starting"` with
 * `running: false` while the child is up but the host API has not answered yet,
 * which is exactly what a large model load looks like for its first several
 * seconds. Collapsing that into "Stopped" makes a brain that is loading
 * correctly read as one that keeps dying.
 */
function resolvePhase(status: BrainHostStatus | null): Phase {
  if (!status) {
    return "stopped";
  }
  if (status.running) {
    return status.state === "starting" ? "starting" : "running";
  }
  if (status.state === "starting") {
    return "starting";
  }
  return status.state === "failed" || status.lastError ? "failed" : "stopped";
}

const PHASE_PRESENTATION: Record<
  Phase,
  { label: string; variant: "success" | "warning" | "error" | "muted" }
> = {
  running: { label: "Running", variant: "success" },
  starting: { label: "Starting", variant: "warning" },
  stopped: { label: "Stopped", variant: "muted" },
  failed: { label: "Failed", variant: "error" },
};

function readNumber(
  source: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRecord(
  source: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecords(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown>[] {
  const value = source?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}
function StatTile({
  Icon,
  label,
  value,
  hint,
}: {
  Icon: typeof ThemedGauge;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <View style={styles.tile}>
      <Icon size={24} uniProps={tileIconColorMapping} />
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.tileHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A labelled proportion bar. `fraction` above 1 renders full and turns red. */
function Meter({ fraction, tone }: { fraction: number; tone: "normal" | "danger" }) {
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%` as const;
  const fillStyle = useMemo(
    () => [styles.meterFill, tone === "danger" && styles.meterFillDanger, { width }],
    [tone, width],
  );
  return (
    <View style={styles.meterTrack}>
      <View style={fillStyle} />
    </View>
  );
}

/** Local brains expose full lifecycle; remote brains expose only host-owned restart. */
function LifecycleControls({
  serverId,
  phase,
  showStartStop,
}: {
  serverId: string;
  phase: Phase;
  showStartStop: boolean;
}) {
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (action: "start" | "stop" | "restart") => {
      if (!client) {
        return;
      }
      setPending(action);
      setError(null);
      try {
        if (action === "start") {
          await client.brainHostStart();
        } else if (action === "stop") {
          await client.brainHostStop();
        } else {
          await client.brainHostRestart();
        }
        await queryClient.invalidateQueries({ queryKey: brainStatusQueryKey(serverId, true) });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [client, queryClient, serverId],
  );

  const handleStart = useCallback(() => void runAction("start"), [runAction]);
  const handleStop = useCallback(() => void runAction("stop"), [runAction]);
  const handleRestart = useCallback(() => void runAction("restart"), [runAction]);

  return (
    <View style={styles.lifecycle}>
      <View style={isCompact ? styles.actionsStacked : styles.actions}>
        {showStartStop ? (
          <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild disabled={pending !== null || phase === "running"}>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={startIcon}
                style={styles.iconButton}
                accessibilityLabel="Start brain"
                onPress={handleStart}
                loading={pending === "start"}
                disabled={pending !== null || phase === "running"}
                testID="brain-overview-start"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>Start</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {showStartStop ? (
          <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild disabled={pending !== null || phase === "stopped"}>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={stopIcon}
                style={styles.iconButton}
                accessibilityLabel="Stop brain"
                onPress={handleStop}
                loading={pending === "stop"}
                disabled={pending !== null || phase === "stopped"}
                testID="brain-overview-stop"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>Stop</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild disabled={pending !== null}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={restartIcon}
              style={styles.iconButton}
              accessibilityLabel="Restart brain"
              onPress={handleRestart}
              loading={pending === "restart"}
              disabled={pending !== null}
              testID="brain-overview-restart"
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>Restart</Text>
          </TooltipContent>
        </Tooltip>
      </View>
      {error ? <Alert variant="error" description={error} /> : null}
    </View>
  );
}

function StatusHero({
  status,
  phase,
  serverId,
  canControlLifecycle,
  showStartStop,
  fillHeight,
}: {
  status: BrainHostStatus | null;
  phase: Phase;
  serverId: string;
  canControlLifecycle: boolean;
  showStartStop: boolean;
  fillHeight?: boolean;
}) {
  const presentation = PHASE_PRESENTATION[phase];
  const endpoint =
    status?.host && status.port
      ? `${status.secure ? "https" : "http"}://${status.displayHost ?? status.host}:${status.port}`
      : null;

  return (
    <View style={[styles.hero, fillHeight && styles.fillHeight]}>
      <View style={styles.heroText}>
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {status?.model ?? "No model loaded"}
          </Text>
          <StatusBadge label={presentation.label} variant={presentation.variant} />
        </View>
        {endpoint ? (
          <Text style={styles.heroSubtitle} numberOfLines={1}>
            {endpoint}
          </Text>
        ) : null}
      </View>
      {canControlLifecycle ? (
        <LifecycleControls serverId={serverId} phase={phase} showStartStop={showStartStop} />
      ) : (
        <Text style={styles.remoteNote}>This brain does not permit remote restart.</Text>
      )}
    </View>
  );
}

function VramPanel({ gpu }: { gpu: Record<string, unknown> | null }) {
  const used = readNumber(gpu, "usedBytes");
  const total = readNumber(gpu, "totalBytes");
  if (!total) {
    return null;
  }
  const fraction = used ? used / total : 0;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>VRAM</Text>
      <Meter fraction={fraction} tone={fraction > 0.95 ? "danger" : "normal"} />
      <Text style={styles.panelCaption}>
        {formatGiB(used)} of {formatGiB(total)}
        {typeof gpu?.name === "string" ? ` · ${gpu.name}` : ""}
      </Text>
    </View>
  );
}

function modelActivityPhase(input: {
  enginePhase: unknown;
  thinking: number;
  generating: number;
}): string {
  if (input.enginePhase === "prefill") return "Processing prompt";
  if (input.thinking > 0 && input.generating === 0) return "Thinking";
  if (input.thinking > 0 && input.generating > 0) return "Decoding";
  return "Generating";
}

function ModelActivityPanel({
  slots,
  inference,
}: {
  slots: Record<string, unknown> | null;
  inference: Record<string, unknown> | null;
}) {
  const threads = readRecords(slots, "threads");
  const processing = readNumber(inference, "processing") ?? 0;
  const thinking = readNumber(inference, "thinking") ?? 0;
  const generating = readNumber(inference, "generating") ?? 0;
  const stageSummary = [
    processing > 0 ? `${processing} processing ${processing === 1 ? "prompt" : "prompts"}` : null,
    thinking > 0 ? `${thinking} thinking` : null,
    generating > 0 ? `${generating} generating` : null,
  ].filter((value): value is string => value !== null);
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Live model activity</Text>
      {stageSummary.length > 0 ? (
        <Text style={styles.panelCaption}>{stageSummary.join(" · ")}</Text>
      ) : null}
      {threads.length === 0 && stageSummary.length === 0 ? (
        <Text style={styles.panelCaption}>No active inference requests.</Text>
      ) : null}
      {threads.length > 0 ? (
        <View style={styles.activityList}>
          {threads.map((thread) => {
            const phase = modelActivityPhase({
              enginePhase: thread.phase,
              thinking,
              generating,
            });
            const rate = readNumber(
              thread,
              thread.phase === "prefill" ? "promptTokensPerSecond" : "tokensPerSecond",
            );
            const tokenCount = readNumber(
              thread,
              thread.phase === "prefill" ? "promptTokens" : "generatedTokens",
            );
            return (
              <View key={String(thread.slot)} style={styles.activityRow}>
                <Text style={styles.activitySlot}>Slot {String(thread.slot)}</Text>
                <Text style={styles.activityPhase}>{phase}</Text>
                <Text style={styles.activityRate}>
                  {rate === null ? "Measuring…" : `${Math.round(rate).toLocaleString()} tok/s`}
                </Text>
                {tokenCount !== null ? (
                  <Text style={styles.activityTokens}>
                    {tokenCount.toLocaleString()}{" "}
                    {thread.phase === "prefill" ? "prompt" : "generated"} tokens
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
function ResourceTiles({
  resources,
  gpu,
  slots,
}: {
  resources: Record<string, unknown> | null;
  gpu: Record<string, unknown> | null;
  slots: Record<string, unknown> | null;
}) {
  const isCompact = useIsCompactFormFactor();
  const ramUsed = readNumber(resources, "ramUsedBytes");
  const ramTotal = readNumber(resources, "ramTotalBytes");
  const cpuCount = readNumber(resources, "cpuCount");
  const gpuUtil = readNumber(gpu, "utilization");
  const gpuTemp = readNumber(gpu, "temperature");
  const slotsTotal = readNumber(slots, "total");
  const slotsBusy = readNumber(slots, "busy");
  const saturated = slotsTotal !== null && slotsBusy !== null && slotsBusy >= slotsTotal;

  return (
    <View style={isCompact ? styles.tileGridCompact : styles.tileGrid}>
      <StatTile
        Icon={ThemedGauge}
        label="CPU"
        value={formatPercent(readNumber(resources, "cpu"))}
        hint={cpuCount ? `${cpuCount} cores` : null}
      />
      <StatTile
        Icon={ThemedLayers}
        label="Memory"
        value={ramUsed && ramTotal ? formatPercent(ramUsed / ramTotal) : "unknown"}
        hint={ramTotal ? `${formatGiB(ramUsed)} of ${formatGiB(ramTotal)}` : null}
      />
      <StatTile
        Icon={ThemedZap}
        label="GPU"
        value={gpuUtil === null ? "unknown" : formatPercent(gpuUtil / 100)}
        hint={gpuTemp ? `${Math.round(gpuTemp)}°C` : null}
      />
      <StatTile
        Icon={ThemedBoxes}
        label="Slots"
        value={slotsTotal === null ? "unknown" : `${slotsBusy ?? 0} / ${slotsTotal}`}
        hint={saturated ? "Saturated, further requests queue" : null}
      />
    </View>
  );
}

/**
 * Traffic and Host readouts, side by side as two tile columns instead of two
 * full-width panels - the same shape as the Metrics page's two-column layout,
 * so both resource pages read as one system. Stacks on compact.
 */
function DetailSections({
  telemetry,
  status,
}: {
  telemetry: Record<string, unknown> | null;
  status: BrainHostStatus | null;
}) {
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={isCompact ? styles.detailColumnsStacked : styles.detailColumns}>
      <TrafficPanel telemetry={telemetry} />
      <View style={isCompact ? styles.dividerHorizontal : styles.dividerVertical} />
      <HostPanel status={status} />
    </View>
  );
}

function TrafficPanel({ telemetry }: { telemetry: Record<string, unknown> | null }) {
  return (
    <View style={styles.detailColumn}>
      <Text style={styles.panelTitle}>Traffic</Text>
      <View style={styles.tileGridCompact}>
        <StatTile Icon={ThemedSend} label="Requests" value={String(telemetry?.requests ?? 0)} />
        <StatTile Icon={ThemedCheckCircle} label="Served" value={String(telemetry?.ok ?? 0)} />
        {/* The two counters this project exists to drive to zero. */}
        <StatTile
          Icon={ThemedPsychology}
          label="Reasoning only"
          value={String(telemetry?.reasoningOnly ?? 0)}
        />
        <StatTile
          Icon={ThemedScissors}
          label="Truncated"
          value={String(telemetry?.truncated ?? 0)}
        />
      </View>
    </View>
  );
}

function HostPanel({ status }: { status: BrainHostStatus | null }) {
  return (
    <View style={styles.detailColumn}>
      <Text style={styles.panelTitle}>Host</Text>
      <View style={styles.tileGridCompact}>
        {status?.version ? (
          <StatTile Icon={ThemedInfo} label="Version" value={status.version} />
        ) : null}
        {status?.pid ? (
          <StatTile Icon={ThemedServer} label="Process" value={String(status.pid)} />
        ) : null}
        {typeof status?.loadSeconds === "number" ? (
          <StatTile
            Icon={ThemedTimeline}
            label="Load time"
            value={`${status.loadSeconds.toFixed(1)}s`}
          />
        ) : null}
        {typeof status?.vramBytes === "number" ? (
          <StatTile
            Icon={ThemedHardDrive}
            label="VRAM at load"
            value={formatGiB(status.vramBytes)}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The llama.cpp runtime this host loads models with - moved here from the
 *  Library tab, since it is host status, not a way to get a model. */
function RuntimePanel({
  serverId,
  isConnected,
  canInstall,
  fillHeight,
}: {
  serverId: string;
  isConnected: boolean;
  canInstall: boolean;
  fillHeight?: boolean;
}) {
  const queryClient = useQueryClient();
  const runtimesQuery = useBrainRuntimes(serverId, isConnected);
  const jobsQuery = useBrainJobs(serverId, isConnected);
  const runtimes = useMemo(() => runtimesQuery.data ?? [], [runtimesQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  useRefreshOnJobCompletion(serverId, jobs);
  const busy = jobs.some((job) => job.status === "running");

  const handleJobStarted = useCallback(
    (job: BrainJob) => {
      queryClient.setQueryData(["brain-jobs", serverId], (prev: BrainJob[] | undefined) =>
        prependJob(prev, job),
      );
    },
    [queryClient, serverId],
  );

  return (
    <View style={[styles.panelFlush, fillHeight && styles.fillHeight]}>
      <RuntimeRow
        serverId={serverId}
        runtimes={runtimes}
        // An empty list only means "not installed" once this host has actually
        // answered. Disconnected, the query never runs and `data` stays
        // undefined - see the note on RuntimeRow.
        answered={runtimesQuery.data !== undefined}
        loading={runtimesQuery.isLoading}
        busy={busy}
        canInstall={canInstall}
        jobs={jobs}
        onStarted={handleJobStarted}
      />
    </View>
  );
}

export function BrainOverviewTab({
  serverId,
  isConnected,
  canControlLifecycle,
  canManageRuntime,
  canInstallRuntime,
  showStartStop,
}: {
  serverId: string;
  isConnected: boolean;
  /** False for a remote brain: it is started on the machine that hosts it. */
  canControlLifecycle: boolean;
  canManageRuntime: boolean;
  canInstallRuntime: boolean;
  showStartStop: boolean;
}) {
  const query = useBrainStatus(serverId, { enabled: isConnected, resources: true });
  const connection = useHostRuntimeConnectionStatus(serverId);
  const stackTopSections = useIsExtraCompactFormFactor();
  const status = query.data ?? null;
  const phase = resolvePhase(status);

  const statusRecord = status as unknown as Record<string, unknown> | null;
  const resources = readRecord(statusRecord, "resources");
  const telemetry = readRecord(statusRecord, "telemetry");
  const telemetryWarning = typeof telemetry?.warning === "string" ? telemetry.warning : null;

  // A host we cannot reach tells us nothing about its brain, and every readout
  // below would otherwise fill in for it: no status reads as "Stopped", an
  // empty runtime list reads as "not installed", and the lifecycle buttons
  // offer to start something over a socket that is not there. Say the true
  // thing instead - a stopped daemon is the common cause, and it is the one
  // the page used to hide behind a wall of confident zeroes.
  if (!isConnected && !status) {
    return connection === "connecting" ? (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" />
      </View>
    ) : (
      <Alert
        variant="info"
        title="This host is not connected"
        description="Otto cannot reach this host's daemon, so its brain status is unknown. Start the daemon on that machine and this page will fill in."
      />
    );
  }

  if (query.isLoading && !status) {
    return (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {status?.lastError && phase === "failed" ? (
        <Alert variant="error" title="The brain stopped" description={status.lastError} />
      ) : null}
      {/* Telemetry advice is derived from observed traffic, not guesswork: the
          router counts responses that spent every token reasoning and returned
          no content, which is the failure the brain exists to prevent. */}
      {telemetryWarning ? <Alert variant="warning" description={telemetryWarning} /> : null}

      <View style={stackTopSections ? styles.topSectionsStacked : styles.topSections}>
        <View style={[styles.topSection, !stackTopSections && styles.topSectionWide]}>
          <StatusHero
            status={status}
            phase={phase}
            serverId={serverId}
            canControlLifecycle={canControlLifecycle}
            showStartStop={showStartStop}
            fillHeight={!stackTopSections}
          />
        </View>
        {canManageRuntime ? (
          <View style={[styles.topSection, !stackTopSections && styles.topSectionWide]}>
            <RuntimePanel
              serverId={serverId}
              isConnected={isConnected}
              canInstall={canInstallRuntime}
              fillHeight={!stackTopSections}
            />
          </View>
        ) : null}
      </View>
      <VramPanel gpu={readRecord(resources, "gpu")} />
      <ResourceTiles
        resources={resources}
        gpu={readRecord(resources, "gpu")}
        slots={readRecord(statusRecord, "slots")}
      />
      <DetailSections telemetry={telemetry} status={status} />
      <ModelActivityPanel
        slots={readRecord(statusRecord, "slots")}
        inference={readRecord(statusRecord, "inference")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  centered: {
    paddingVertical: theme.spacing[12],
    alignItems: "center",
    justifyContent: "center",
  },
  topSections: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[4],
  },
  topSectionsStacked: {
    gap: theme.spacing[4],
  },
  topSection: {
    minWidth: 0,
  },
  topSectionWide: {
    flex: 1,
  },
  fillHeight: {
    flex: 1,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2 - see the note on `tile` below: surface2 and
    // border are nearly identical on this theme, so a surface2 fill swallows
    // the border and the card reads as borderless.
    backgroundColor: theme.colors.surface1,
    flexWrap: "wrap",
  },
  heroText: {
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  heroTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  heroSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  remoteNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionsStacked: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  iconButton: {
    width: 40,
    paddingHorizontal: 0,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  lifecycle: {
    gap: theme.spacing[2],
  },
  panel: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  // Same card, no padding: for a settings row (`settingsStyles.rowResponsive`)
  // that already carries its own `spacing[4]` inset. Nesting one inside `panel`
  // pads it twice.
  panelFlush: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  panelTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  panelCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  activityList: {
    gap: theme.spacing[2],
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  activitySlot: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  activityPhase: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexGrow: 1,
  },
  activityRate: {
    color: theme.colors.accentBright,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  activityTokens: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  meterTrack: {
    height: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentBright,
  },
  meterFillDanger: {
    backgroundColor: theme.colors.palette.red[500],
  },
  tileGrid: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  tileGridCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 96,
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: the border token sits right next to surface2 on
    // this theme (#33333a vs #323238), so a surface2 fill swallows the border
    // and the tile reads as a borderless blob. surface1 gives the border
    // something to contrast against, same as the Metrics page's tiles.
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  tileValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  tileHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  // Traffic | Host, side by side like the Metrics page's two-column layout -
  // each gets a titled tile grid instead of one wide list panel.
  detailColumns: {
    flexDirection: "row",
    gap: theme.spacing[4],
  },
  detailColumnsStacked: {
    flexDirection: "column",
    gap: theme.spacing[4],
  },
  detailColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  dividerVertical: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: theme.colors.border,
  },
  dividerHorizontal: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
