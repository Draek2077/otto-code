import { useStyles } from "./styles";
import { useIsExtraCompactFormFactor } from "../ui/layout";
import type {
  BrainGpu,
  BrainResources,
  BrainSlots,
  BrainTelemetry,
  BrainInference,
} from "../contracts/host";
import { useBrainOperations, useBrainHost, useBrainPreferences } from "../context";
import type { BrainHostStatus } from "../contracts/host";
/**
 * The Overview tab: what the brain is doing right now.
 *
 * This is the TUI's header, status panel and VRAM panel, promoted out of the
 * settings dashboard sheet. It is the only tab that asks for live resource
 * telemetry, because that costs an `nvidia-smi` spawn on the brain and nothing
 * else renders the numbers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { withBrainTheme } from "../theme";

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
} from "../ui/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner } from "../theme";
import { SelectField } from "../ui/select-field";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  formatBrainRuntime,
  resolveSelectedBrainRuntime,
  RuntimeManagerSheet,
} from "../library/runtime-manager";

import { useBrainJobs, useBrainRuntimes } from "../data";

import type { BrainScreenTheme as Theme } from "../theme";
import { useBrainModelNames, useBrainStatus } from "../data";
import { formatGiB, formatPercent } from "../format";
import {
  formatBrainRuntimeShortLabel,
  isBrainRuntimeManagementAvailable,
  resolveBrainHostRuntime,
  resolveHostSelectedBrainRuntime,
  type BrainRuntimePhase,
} from "../runtime-management";
import { resolveBrainOverviewError } from "../brain-availability";

const ThemedPlay = withBrainTheme(Play);
const ThemedSquare = withBrainTheme(Square);
const ThemedRotateCw = withBrainTheme(RotateCw);
const ThemedLoadingSpinner = BrainLoadingSpinner;

const foregroundIcon = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});

const startIcon = <ThemedPlay uniProps={foregroundIcon} />;
const stopIcon = <ThemedSquare uniProps={foregroundIcon} />;
const restartIcon = <ThemedRotateCw uniProps={foregroundIcon} />;
const brainModelValueKey = (value: string | null): string => value ?? "__automatic__";

// Icon-topped tiles, matching the Metrics page's tile language so the two
// resource pages read as one system instead of two different eras of the UI.
const ThemedGauge = withBrainTheme(Gauge);
const ThemedLayers = withBrainTheme(Layers);
const ThemedZap = withBrainTheme(Zap);
const ThemedBoxes = withBrainTheme(Boxes);
const ThemedSend = withBrainTheme(Send);
const ThemedCheckCircle = withBrainTheme(CheckCircle);
const ThemedPsychology = withBrainTheme(Psychology);
const ThemedScissors = withBrainTheme(Scissors);
const ThemedInfo = withBrainTheme(Info);
const ThemedServer = withBrainTheme(Server);
const ThemedTimeline = withBrainTheme(Timeline);
const ThemedHardDrive = withBrainTheme(HardDrive);

const tileIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const tileIconWarningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarningMuted });

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

function readNumber<Source extends object>(
  source: Source | null | undefined,
  key: keyof Source,
): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function StatTile({
  Icon,
  label,
  value,
  hint,
  warning = false,
}: {
  Icon: typeof ThemedGauge;
  label: string;
  value: string;
  hint?: string | null;
  warning?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={warning ? [styles.tile, styles.tileWarning] : styles.tile}>
      <Icon size={24} uniProps={warning ? tileIconWarningColorMapping : tileIconColorMapping} />
      <Text
        style={warning ? [styles.tileValue, styles.tileValueWarning] : styles.tileValue}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={warning ? [styles.tileLabel, styles.tileTextWarning] : styles.tileLabel}
        numberOfLines={1}
      >
        {label}
      </Text>
      {hint ? (
        <Text
          style={warning ? [styles.tileHint, styles.tileTextWarning] : styles.tileHint}
          numberOfLines={1}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A labelled proportion bar. `fraction` above 1 renders full and turns red. */
function Meter({ fraction, tone }: { fraction: number; tone: "normal" | "danger" }) {
  const styles = useStyles();
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%` as const;
  const fillStyle = useMemo(
    () => [styles.meterFill, tone === "danger" && styles.meterFillDanger, { width }],
    [styles, tone, width],
  );
  return (
    <View style={styles.meterTrack}>
      <View style={fillStyle} />
    </View>
  );
}

/** Local brains expose full lifecycle; remote brains expose only host-owned restart. */
function LifecycleControls({
  phase,
  showStartStop,
}: {
  serverId: string;
  phase: Phase;
  showStartStop: boolean;
}) {
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  const client = useBrainOperations();
  const modelNamesQuery = useBrainModelNames(showStartStop);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [pending, setPending] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modelOptions = useMemo<SelectFieldOption<string | null>[]>(
    () => [
      { id: "__automatic__", value: null, label: "Automatic" },
      ...(modelNamesQuery.data ?? []).map((model) => ({
        id: model.modelId,
        value: model.modelId,
        label: model.label,
      })),
    ],
    [modelNamesQuery.data],
  );
  const selectedModelDisplay = useMemo(
    () => ({
      label:
        modelOptions.find((option) => option.value === modelOverride)?.label ?? "Unavailable model",
    }),
    [modelOverride, modelOptions],
  );

  const runAction = useCallback(
    async (action: "start" | "stop" | "restart") => {
      if (!client) {
        return;
      }
      setPending(action);
      setError(null);
      try {
        if (action === "start") {
          await client.startHost(modelOverride);
        } else if (action === "stop") {
          await client.stopHost();
        } else {
          await client.restartHost(modelOverride);
        }
        await client.refresh(["status"]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [client, modelOverride],
  );

  const handleStart = useCallback(() => void runAction("start"), [runAction]);
  const handleStop = useCallback(() => {
    void confirmDialog({
      title: "Stop the brain?",
      message: "Any loaded model is unloaded and requests stop until you start it again.",
      confirmLabel: "Stop",
      cancelLabel: "Cancel",
      destructive: true,
    })
      .then((confirmed) => {
        if (confirmed) void runAction("stop");
        return undefined;
      })
      .catch(() => undefined);
  }, [runAction]);
  const handleRestart = useCallback(() => {
    void confirmDialog({
      title: "Restart the brain?",
      message: "The host stops and starts again, reloading the selected model.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    })
      .then((confirmed) => {
        if (confirmed) void runAction("restart");
        return undefined;
      })
      .catch(() => undefined);
  }, [runAction]);

  return (
    <View style={styles.lifecycle}>
      {showStartStop ? (
        <SelectField<string | null>
          field={false}
          size="sm"
          label="Model override"
          value={modelOverride}
          selectedDisplay={selectedModelDisplay}
          options={modelOptions}
          onChange={setModelOverride}
          placeholder="Automatic"
          emptyText="No installed models found"
          loading={modelNamesQuery.isLoading}
          disabled={pending !== null || modelNamesQuery.isLoading}
          searchable
          getValueKey={brainModelValueKey}
          triggerStyle={styles.modelOverrideTrigger}
          triggerTestID="brain-overview-model-override"
        />
      ) : null}
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
  const styles = useStyles();
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

function VramPanel({ gpu }: { gpu: BrainGpu | null }) {
  const styles = useStyles();
  const used = readNumber(gpu, "usedBytes");
  const total = readNumber(gpu, "totalBytes");
  if (!total) {
    return null;
  }
  const fraction = used !== null ? used / total : 0;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{gpu?.driver === "Metal" ? "GPU working set" : "VRAM"}</Text>
      {used !== null ? (
        <Meter fraction={fraction} tone={fraction > 0.95 ? "danger" : "normal"} />
      ) : null}
      <Text style={styles.panelCaption}>
        {used !== null
          ? `${formatGiB(used)} of ${formatGiB(total)}`
          : `${formatGiB(total)} Metal working set · usage unavailable`}
        {typeof gpu?.name === "string" ? ` · ${gpu.name}` : ""}
      </Text>
    </View>
  );
}

/**
 * The request stage a slot row can show, from the proxy's per-slot join
 * (`inference.slotStages`, host API v3).
 *
 * The router pins every dispatch to one llama-server slot (`id_slot`) and
 * records the stage of the request that owns the pin, so "thinking" - a
 * stage the engine cannot report - can be attributed to the exact slot the
 * panel shows. Absent on brains that predate the join, or for requests that
 * could not be pinned (the engine could not be sampled), which is why every
 * lookup below has a fallback.
 */
type SlotRequestStage = "processing" | "thinking" | "generating";

/**
 * What the slot is doing, in the same words the rail uses ("processing
 * tokens", "thinking", "generating tokens"), never the engine jargon.
 *
 * The row is the slot, so the engine phase (llama-server's `/slots`, sampled
 * at 4 Hz) stays the ground truth for *where* the slot is: a prefill row is
 * ingesting its prompt no matter what the proxy last saw. A decode row is
 * emitting tokens; the request stage then decides *which kind* - "thinking"
 * when the pinned request is mid-reasoning, "generating tokens" otherwise.
 *
 * A decode row without a joined stage (older brain, unpinned request) says
 * "generating tokens" rather than "Decoding": that is exactly what the engine
 * is doing, and it is the same claim the rail makes for the same slot, so the
 * row and the icon can no longer disagree about a word. A "processing" stage
 * on a decode row is the sub-second boundary race (first token out, first
 * delta not yet observed), and "generating tokens" is the honest label for it.
 *
 * The pre-join bug this replaces: folding the GLOBAL thinking/generating
 * counts into every row relabelled *every* decode slot "Thinking" because one
 * request thought - the panel then printed "1 thinking" above two rows both
 * reading "Thinking", contradicting its own summary.
 */
function modelActivityPhase(enginePhase: unknown, requestStage: SlotRequestStage | null): string {
  if (enginePhase === "prefill") {
    return "Processing tokens";
  }
  // Decode row. The joined stage is the request's own word for what it is
  // doing and is always present when this brain supports the join - the panel
  // reads it from the same snapshot that produced the summary line, so a row
  // and the summary can never disagree about a word. Only when the snapshot
  // carries no stage data at all (older brain) does the row fall back to the
  // engine phase: a decode slot is, by definition, emitting tokens.
  if (requestStage === "thinking") return "Thinking";
  if (requestStage === "generating") return "Generating tokens";
  if (requestStage === "processing") return "Processing tokens";
  return "Generating tokens";
}
/**
 * The panel shows one picture in two resolutions:
 *
 *  - The **summary line** counts *requests* in flight, from the proxy's own
 *    `inference` tracker.
 *  - The **slot rows** show what each slot is doing. With the host API v3
 *    join (`inference.slotStages`) the row says the request's own stage -
 *    thinking, generating tokens, processing tokens; without it (older brain,
 *    unpinned request) it falls back to the slot's engine phase, which is
 *    still user-facing wording, never engine jargon.
 *
 * The row can be a step fresher than the summary (stage observed on a chunk
 * before the next 4 Hz `/slots` sample) and the summary can name a stage whose
 * row has not appeared yet. Both are true at their own resolution; neither is
 * a correction of the other.
 */
function ModelActivityPanel({
  slots,
  inference,
  residents,
}: {
  slots: BrainSlots | null;
  inference: BrainInference | null;
  residents: BrainHostStatus["residents"];
}) {
  const styles = useStyles();
  const threads = slots?.threads ?? [];
  const multipleResidents =
    new Set([
      ...residents.map((resident) => resident.residentId),
      ...threads.map((thread) => thread.residentId),
    ]).size > 1;
  const processing = readNumber(inference, "processing") ?? 0;
  const thinking = readNumber(inference, "thinking") ?? 0;
  const generating = readNumber(inference, "generating") ?? 0;
  const activeRequests = processing + thinking + generating;
  const stageSummary = [
    processing > 0 ? `${processing} processing ${processing === 1 ? "prompt" : "prompts"}` : null,
    thinking > 0 ? `${thinking} thinking` : null,
    generating > 0 ? `${generating} generating` : null,
  ].filter((value): value is string => value !== null);
  // The request tracker says work is in flight but the slot sample shows no
  // busy row - the slot read is a 4 Hz loopback, so this is the sub-second gap
  // at a request boundary, not a contradiction. Say so rather than showing an
  // empty panel under a non-empty summary.
  const requestsWithoutSlot = activeRequests > 0 && threads.length === 0;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Live model activity</Text>
      {stageSummary.length > 0 ? (
        <Text style={styles.panelCaption}>{stageSummary.join(" · ")}</Text>
      ) : null}
      {threads.length === 0 && stageSummary.length === 0 ? (
        <Text style={styles.panelCaption}>No active inference requests.</Text>
      ) : null}
      {requestsWithoutSlot ? (
        <Text style={styles.panelCaption}>Slot state appears on the next refresh.</Text>
      ) : null}
      {threads.length > 0 ? (
        <View style={styles.activityList}>
          {threads.map((thread) => {
            const stage = thread.stage;
            const phase = modelActivityPhase(thread.phase, stage);
            const rate = readNumber(
              thread,
              thread.phase === "prefill" ? "promptTokensPerSecond" : "tokensPerSecond",
            );
            const tokenCount = readNumber(
              thread,
              thread.phase === "prefill" ? "promptTokens" : "generatedTokens",
            );
            return (
              <View
                key={JSON.stringify([thread.modelId, thread.residentId, thread.slot])}
                style={styles.activityRow}
              >
                <Text style={styles.activitySlot}>
                  {multipleResidents
                    ? `${thread.modelId} · ${thread.residentId} · Slot ${String(thread.slot)}`
                    : `Slot ${String(thread.slot)}`}
                </Text>
                <Text style={styles.activityPhase}>{phase}</Text>
                {/*
                  No placeholder while a rate is unknown. The host now holds the
                  last measured rate for as long as the slot stays on the same
                  request, so `null` here means only one thing: not a single
                  token has crossed yet on this request. A "Measuring…" caption
                  for that sub-second state read as a status the row kept
                  flipping back into, and it displaced the number that was
                  already there. An absent rate simply leaves the column empty,
                  the same way the token count already behaves.
                */}
                {rate !== null ? (
                  <Text style={styles.activityRate}>
                    {`${Math.round(rate).toLocaleString()} tok/s`}
                  </Text>
                ) : null}
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
  resources: BrainResources | null;
  gpu: BrainGpu | null;
  slots: BrainSlots | null;
}) {
  const styles = useStyles();
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
        warning={saturated}
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
  telemetry: BrainTelemetry | null;
  status: BrainHostStatus | null;
}) {
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={isCompact ? styles.detailColumnsStacked : styles.detailColumns}>
      <TrafficPanel telemetry={telemetry} />
      <HostPanel status={status} />
    </View>
  );
}

function TrafficPanel({ telemetry }: { telemetry: BrainTelemetry | null }) {
  const styles = useStyles();
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
  const styles = useStyles();
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
  status,
  brainStatusKnown,
  brainStatusError,
  brainPhase,
  canManage,
  canInstall,
  fillHeight,
}: {
  serverId: string;
  isConnected: boolean;
  status: BrainHostStatus | null;
  brainStatusKnown: boolean;
  brainStatusError: boolean;
  brainPhase: BrainRuntimePhase;
  canManage: boolean;
  canInstall: boolean;
  fillHeight?: boolean;
}) {
  const styles = useStyles();
  const runtimesQuery = useBrainRuntimes(isConnected);
  const jobsQuery = useBrainJobs(isConnected);
  const runtimes = useMemo(() => runtimesQuery.data ?? [], [runtimesQuery.data]);
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
  const preferences = useBrainPreferences();
  const [managerVisible, setManagerVisible] = useState(false);
  const busy = jobs.some((job) => job.status === "running");

  const handleJobStarted = useBrainOperations().observeJob;

  const selectedPath = preferences.runtimeSelectionId;
  const selectedRuntime = useMemo(
    () => resolveSelectedBrainRuntime(runtimes, selectedPath),
    [runtimes, selectedPath],
  );
  // The status belongs to the Brain host, while daemon config and the runtime
  // inventory can describe the client machine. Prefer the host-owned value so
  // a remote Brain never reports the local machine's runtime state.
  const hostRuntime = resolveBrainHostRuntime(status?.runtime);
  const hostMatchedRuntime = useMemo(
    () => resolveHostSelectedBrainRuntime(runtimes, hostRuntime),
    [runtimes, hostRuntime],
  );
  const runtimeManagementAvailable = isBrainRuntimeManagementAvailable({
    managementAllowed: canManage,
    hostConnected: isConnected,
    brainStatusKnown,
    brainStatusError,
    brainPhase,
    runtimeListAnswered: runtimesQuery.data !== undefined,
    runtimeListError: runtimesQuery.isError,
  });
  useEffect(() => {
    if (!runtimeManagementAvailable) {
      setManagerVisible(false);
    }
  }, [runtimeManagementAvailable]);
  let runtimeName = "Runtime unavailable";
  let runtimeDetail = "No managed runtime installed";
  let runtimeHealthLabel = "Action needed";
  let runtimeHealthVariant: "success" | "warning" | "muted" = "warning";
  if (hostRuntime) {
    runtimeName = "llama.cpp";
    // The hero shows the runtime's presentation label; the raw host identity
    // only surfaces when the runtime is absent from the local inventory.
    runtimeDetail = hostMatchedRuntime
      ? (formatBrainRuntimeShortLabel(hostMatchedRuntime) ?? formatBrainRuntime(hostMatchedRuntime))
      : hostRuntime;
    runtimeHealthLabel = "Installed";
    runtimeHealthVariant = "success";
  } else if (runtimesQuery.data === undefined) {
    runtimeName = "Runtime status unknown";
    runtimeDetail = "Checking runtime";
    runtimeHealthLabel = "Status unknown";
    runtimeHealthVariant = "muted";
  } else if (selectedRuntime) {
    runtimeName = "llama.cpp";
    runtimeDetail =
      formatBrainRuntimeShortLabel(selectedRuntime) ?? formatBrainRuntime(selectedRuntime);
    runtimeHealthLabel = "Installed";
    runtimeHealthVariant = "success";
  }
  const handleOpenManager = useCallback(() => setManagerVisible(true), []);
  const handleCloseManager = useCallback(() => setManagerVisible(false), []);

  return (
    <>
      <View style={[styles.hero, fillHeight && styles.fillHeight]}>
        <View style={styles.heroText}>
          <View style={styles.heroTitleRow}>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {runtimeName}
            </Text>
            <StatusBadge label={runtimeHealthLabel} variant={runtimeHealthVariant} />
          </View>
          <Text style={styles.heroSubtitle} numberOfLines={1}>
            {runtimeDetail}
          </Text>
        </View>
        {runtimeManagementAvailable ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpenManager}
            testID="brain-manage-runtime-button"
          >
            Manage runtime
          </Button>
        ) : null}
      </View>
      <RuntimeManagerSheet
        visible={managerVisible}
        onClose={handleCloseManager}
        serverId={serverId}
        runtimes={runtimes}
        answered={runtimesQuery.data !== undefined}
        loading={runtimesQuery.isLoading}
        busy={busy}
        canInstall={canInstall}
        hostRuntime={hostRuntime}
        jobs={jobs}
        onStarted={handleJobStarted}
      />
    </>
  );
}

interface BrainOverviewProps {
  serverId: string;
  isConnected: boolean;
  /** False for a remote brain: it is started on the machine that hosts it. */
  canControlLifecycle: boolean;
  /** The connected daemon implements host-owned runtime reads. */
  showRuntime: boolean;
  canManageRuntime: boolean;
  canInstallRuntime: boolean;
  showStartStop: boolean;
}

export function BrainOverviewTab(props: BrainOverviewProps) {
  const view = useOverview(props);
  return <OverviewView view={view} />;
}

function useOverview({
  serverId,
  isConnected,
  canControlLifecycle,
  showRuntime,
  canManageRuntime,
  canInstallRuntime,
  showStartStop,
}: BrainOverviewProps) {
  const styles = useStyles();
  const query = useBrainStatus({ enabled: isConnected, resources: true });
  const connection = useBrainHost().connectionStatus;
  const stackTopSections = useIsExtraCompactFormFactor();
  const status = query.data ?? null;
  const phase = resolvePhase(status);

  const resources = status?.resources ?? null;
  const telemetry = status?.telemetry ?? null;
  const telemetryWarning = typeof telemetry?.warning === "string" ? telemetry.warning : null;
  const statusError = resolveBrainOverviewError({
    isConnected,
    error: query.error,
    phase,
    lastError: status?.lastError,
  });

  return {
    styles,
    serverId,
    isConnected,
    canControlLifecycle,
    showRuntime,
    canManageRuntime,
    canInstallRuntime,
    showStartStop,
    query,
    connection,
    stackTopSections,
    status,
    phase,
    resources,
    telemetry,
    telemetryWarning,
    statusError,
  };
}

type OverviewViewState = ReturnType<typeof useOverview>;

function OverviewView({ view }: { view: OverviewViewState }) {
  const { styles, isConnected, query, connection, status, telemetryWarning, statusError } = view;
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
      {statusError ? (
        <Alert variant="error" title={statusError.title} description={statusError.description} />
      ) : null}
      {/* Telemetry advice is derived from observed traffic, not guesswork: the
          router counts responses that spent every token reasoning and returned
          no content, which is the failure the brain exists to prevent. */}
      {!statusError && telemetryWarning ? (
        <Alert variant="warning" description={telemetryWarning} />
      ) : null}

      <OverviewHeroPanels view={view} />
      <OverviewMetrics view={view} />
    </View>
  );
}

function OverviewHeroPanels({ view }: { view: OverviewViewState }) {
  const {
    styles,
    serverId,
    isConnected,
    canControlLifecycle,
    showRuntime,
    canManageRuntime,
    canInstallRuntime,
    showStartStop,
    query,
    stackTopSections,
    status,
    phase,
  } = view;
  return (
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
      {showRuntime ? (
        <View style={[styles.topSection, !stackTopSections && styles.topSectionWide]}>
          <RuntimePanel
            serverId={serverId}
            isConnected={isConnected}
            status={status}
            brainStatusKnown={status !== null}
            brainStatusError={query.isError}
            brainPhase={phase}
            canManage={canManageRuntime}
            canInstall={canInstallRuntime}
            fillHeight={!stackTopSections}
          />
        </View>
      ) : null}
    </View>
  );
}

function OverviewMetrics({ view }: { view: OverviewViewState }) {
  const { status, resources, telemetry, statusError } = view;
  if (statusError) return null;
  return (
    <>
      <VramPanel gpu={resources?.gpu ?? null} />
      <ResourceTiles
        resources={resources}
        gpu={resources?.gpu ?? null}
        slots={status?.slots ?? null}
      />
      <DetailSections telemetry={telemetry} status={status} />
      <ModelActivityPanel
        slots={status?.slots ?? null}
        inference={status?.inference ?? null}
        residents={status?.residents ?? []}
      />
    </>
  );
}
